/**
 * Durable sign queue (see CLAUDE.md state machine).
 *
 * Guarantees:
 * - every state lives in expo-sqlite and survives app kill/restart;
 * - the client-generated idempotency UUID means retries NEVER double-sign or
 *   double-issue (the backend replays the stored result for a repeated key);
 * - the queued PDF's SHA-256 is re-verified before every upload attempt to
 *   detect local corruption;
 * - upload failure returns the item to QUEUED_FOR_SIGNING with exponential
 *   backoff (retry on reconnect / app foreground / launch).
 */
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Location from 'expo-location';
import type { IntentToSign, SignSubmission, Verification } from '@prowalco/schema';
import { validateReadyToSign } from '@prowalco/schema';
import { confirmReceipt, submitForSigning } from '../api/client';
import * as repo from '../db/certificateRepo';
import { sha256HexOfBase64 } from '../lib/bytes';
import { persistSignedPdf, renderCertificatePdf } from '../pdf/renderPdf';

export class SignQueueError extends Error {}

/**
 * The full "tap Sign" flow: readiness gate → biometric re-prompt →
 * intent-to-sign capture (device time + optional GPS with consent) →
 * on-device PDF render → durable enqueue.
 */
export async function enqueueForSigning(
  certificateId: string,
  verification: Verification,
  gpsConsentGiven: boolean,
  signatures: { customerSignatureSvg?: string; voSignatureSvg?: string } = {},
): Promise<void> {
  const readiness = validateReadyToSign(verification);
  if (!readiness.ready) {
    throw new SignQueueError(`Not ready to sign:\n${readiness.reasons.join('\n')}`);
  }

  const auth = await LocalAuthentication.authenticateAsync({
    promptMessage: `Sign certificate ${verification.certificateNumber}`,
    disableDeviceFallback: false,
  });
  if (!auth.success) throw new SignQueueError('Identity confirmation cancelled');

  let gps: IntentToSign['gps'];
  if (gpsConsentGiven) {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.granted) {
      const fix = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }).catch(() => null);
      if (fix) {
        gps = {
          latitude: fix.coords.latitude,
          longitude: fix.coords.longitude,
          accuracyM: fix.coords.accuracy ?? 0,
          consentGiven: true,
        };
      }
    }
  }

  const intent: IntentToSign = {
    deviceTimestamp: new Date().toISOString(),
    deviceId: await getDeviceId(),
    gps,
  };

  const pdf = await renderCertificatePdf(verification, signatures);

  // READY_TO_SIGN is a checkpoint between validation and biometric; we pass
  // through it and land in the durable queue in one save.
  repo.transition(certificateId, 'READY_TO_SIGN');
  repo.transition(certificateId, 'QUEUED_FOR_SIGNING', {
    form_json: JSON.stringify(verification),
    idempotency_key: Crypto.randomUUID(),
    pdf_uri: pdf.uri,
    pdf_sha256: pdf.sha256,
    intent_json: JSON.stringify(intent),
  });
}

/** Drains the queue. Called on launch, on app foreground, and whenever
 * connectivity returns (useSignQueue hook). Safe to call concurrently-ish:
 * items already UPLOADING are skipped. */
export async function processQueue(accessToken: string | null): Promise<void> {
  const queued = repo.listInState('QUEUED_FOR_SIGNING');
  const nowIso = new Date().toISOString();

  for (const item of queued) {
    if (item.nextRetryAt && item.nextRetryAt > nowIso) continue;
    if (!item.pdfUri || !item.pdfSha256 || !item.idempotencyKey || !item.intent) continue;

    try {
      // Integrity: re-hash the stored PDF before every attempt.
      const base64 = await FileSystem.readAsStringAsync(item.pdfUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (sha256HexOfBase64(base64) !== item.pdfSha256) {
        repo.recordRetryFailure(item.id, 'Local PDF failed integrity check — re-render required');
        continue;
      }

      repo.transition(item.id, 'UPLOADING');
      const submission: SignSubmission = {
        idempotencyKey: item.idempotencyKey,
        verification: item.form as Verification,
        pdfSha256: item.pdfSha256,
        pdfBase64: base64,
        intentToSign: item.intent,
      };
      const response = await submitForSigning(accessToken, submission);

      // Verify what came back before trusting it.
      if (sha256HexOfBase64(response.signedPdfBase64) !== response.signedPdfSha256) {
        throw new SignQueueError('Signed PDF hash mismatch in response');
      }
      const signedUri = await persistSignedPdf(response.certificateNumber, response.signedPdfBase64);

      repo.transition(item.id, 'SIGNED', {
        signed_pdf_uri: signedUri,
        signed_pdf_sha256: response.signedPdfSha256,
        signature_id: response.signatureId,
        signed_at: response.signedAt,
        last_error: null,
      });

      // SIGNED -> SYNCED once the server confirms the audit record.
      await confirmReceipt(accessToken, response.certificateNumber);
      repo.transition(item.id, 'SYNCED');
    } catch (err) {
      const current = repo.getById(item.id);
      if (current?.state === 'UPLOADING') {
        repo.transition(item.id, 'QUEUED_FOR_SIGNING');
      }
      if (current?.state === 'SIGNED') {
        // Signing succeeded but the receipt call failed — retry receipt later;
        // the certificate itself is safe and idempotent.
        continue;
      }
      repo.recordRetryFailure(item.id, err instanceof Error ? err.message : String(err));
    }
  }

  // Separately retry SIGNED -> SYNCED confirmations that failed earlier.
  for (const item of repo.listInState('SIGNED')) {
    if (!item.certificateNumber) continue;
    try {
      await confirmReceipt(accessToken, item.certificateNumber);
      repo.transition(item.id, 'SYNCED');
    } catch {
      // stay SIGNED; next drain retries
    }
  }
}

const DEVICE_ID_FILE = () => `${FileSystem.documentDirectory}device-id`;

async function getDeviceId(): Promise<string> {
  try {
    return await FileSystem.readAsStringAsync(DEVICE_ID_FILE());
  } catch {
    const id = Crypto.randomUUID();
    await FileSystem.writeAsStringAsync(DEVICE_ID_FILE(), id);
    return id;
  }
}

import { z } from 'zod';
import { verificationSchema } from './verification';

/**
 * Sign-queue / signing API envelope shared by the mobile queue and the
 * backend /certificates/sign endpoint.
 */

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const isoDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);

export const gpsFixSchema = z.object({
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  accuracyM: z.number().nonnegative(),
  /** POPIA: GPS is only captured with explicit consent. */
  consentGiven: z.literal(true),
});

export const intentToSignSchema = z.object({
  /** Device clock at the moment the technician passed the biometric prompt. */
  deviceTimestamp: isoDateTime,
  deviceId: z.string().min(1).max(128),
  gps: gpsFixSchema.optional(),
});

export const signSubmissionSchema = z.object({
  /** Client-generated UUID — retries never double-sign or double-issue. */
  idempotencyKey: uuid,
  verification: verificationSchema,
  /** SHA-256 of the unsigned PDF bytes, computed on-device. */
  pdfSha256: sha256Hex,
  /** Unsigned PDF rendered on-device by expo-print, base64-encoded. */
  pdfBase64: z.string().min(1),
  intentToSign: intentToSignSchema,
});

export const signResponseSchema = z.object({
  certificateNumber: z.string(),
  status: z.literal('issued'),
  signedPdfBase64: z.string(),
  signedPdfSha256: sha256Hex,
  signatureId: z.string(),
  /** Cryptographic signing time from the RFC 3161 TSA (or server clock in dev). */
  signedAt: isoDateTime,
  auditId: z.string(),
});

export type SignSubmission = z.infer<typeof signSubmissionSchema>;
export type SignResponse = z.infer<typeof signResponseSchema>;
export type IntentToSign = z.infer<typeof intentToSignSchema>;

/** Sign-queue state machine (persisted in expo-sqlite; see CLAUDE.md). */
export const CERTIFICATE_STATES = [
  'DRAFT',
  'READY_TO_SIGN',
  'QUEUED_FOR_SIGNING',
  'UPLOADING',
  'SIGNED',
  'SYNCED',
] as const;

export type CertificateState = (typeof CERTIFICATE_STATES)[number];

export const STATE_TRANSITIONS: Record<CertificateState, CertificateState[]> = {
  DRAFT: ['READY_TO_SIGN'],
  READY_TO_SIGN: ['DRAFT', 'QUEUED_FOR_SIGNING'], // back to DRAFT on any edit
  QUEUED_FOR_SIGNING: ['UPLOADING'],
  UPLOADING: ['QUEUED_FOR_SIGNING', 'SIGNED'], // back to queue on failure
  SIGNED: ['SYNCED'],
  SYNCED: [],
};

export function canTransition(from: CertificateState, to: CertificateState): boolean {
  return STATE_TRANSITIONS[from].includes(to);
}

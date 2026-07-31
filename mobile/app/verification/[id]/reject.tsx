/**
 * Rejection certificate creation (#92): from an ISSUED verification with
 * rejected hoses, the VO confirms the physical rejection steps (PROC02 5.5),
 * reviews the derived reasons, and seals a rejection certificate through the
 * same signing pipeline. Online-only in v1; NRCS delivery is a later phase.
 */
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { Alert, Switch, Text, TextInput, View } from 'react-native';
import type { RejectionCertificate, Verification } from '@prowalco/schema';
import {
  CHECKLIST_ITEMS,
  NOZZLE_BURST_LIMIT_ML,
  rejectionCertificateSchema,
  testPlanFor,
} from '@prowalco/schema';
import { getDispenser, submitRejectionForSigning } from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { Badge, Button, SectionCard, colors } from '../../../src/components/ui';
import { FormScrollView } from '../../../src/components/FormScrollView';
import { fetchThrough } from '../../../src/db/cache';
import * as repo from '../../../src/db/certificateRepo';
import { renderRejectionPdf, persistSignedPdf } from '../../../src/pdf/renderPdf';
import { getProfile } from '../../../src/profile/profileStore';
import { buildDeviceAuth, getDeviceId } from '../../../src/queue/signQueue';

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: 10,
  paddingHorizontal: 10,
  paddingVertical: 8,
  color: colors.ink,
  backgroundColor: '#fff',
  fontSize: 13,
} as const;

/** Reasons derived from the recorded evidence, per rejected hose. */
function deriveReasons(v: Partial<Verification>, hoseIndex: number): string[] {
  const h = v.hoses![hoseIndex];
  const reasons: string[] = [];
  for (const item of CHECKLIST_ITEMS) {
    if (h.checklist[item.key] === 'fail') reasons.push(`${item.label}: failed`);
  }
  const plan = testPlanFor(v);
  for (const d of h.deliveries) {
    if ((d.vrefMl ?? 0) > 0 && !d.pass) {
      const label =
        plan.deliveries.find((pd) => pd.point === d.point)?.label ?? d.point;
      reasons.push(
        `${label}: EFD ${d.efdPercent?.toFixed(2)}% outside the ±${plan.mpePercent}% MPE`,
      );
    }
  }
  if ((h.nozzleBurstMl ?? 0) > NOZZLE_BURST_LIMIT_ML) {
    reasons.push(
      `Nozzle burst +${h.nozzleBurstMl} ml exceeds the ${NOZZLE_BURST_LIMIT_ML} ml limit`,
    );
  }
  return reasons;
}

export default function RejectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { identity, accessToken } = useAuth();
  const record = useMemo(() => repo.getById(id), [id]);
  const v = record?.form as Partial<Verification> | null;
  const rejectedIdx = useMemo(
    () =>
      (v?.hoses ?? [])
        .map((h, i) => (h.outcome === 'rejected' ? i : -1))
        .filter((i) => i >= 0),
    [v],
  );
  const [extra, setExtra] = useState<Record<number, string>>({});
  const [marksObliterated, setMarksObliterated] = useState(false);
  const [rejectionMarkApplied, setRejectionMarkApplied] = useState(false);
  const [nozzleSwitchRemoved, setNozzleSwitchRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issuedUri, setIssuedUri] = useState<string | null>(null);
  const [issuedNumber, setIssuedNumber] = useState<string | null>(null);
  // One idempotency key per screen visit: retries never double-issue.
  const idempotencyKey = useRef(Crypto.randomUUID());

  if (!record || !v?.hoses) return <Text style={{ padding: 16 }}>Not found</Text>;
  if (rejectedIdx.length === 0) {
    return (
      <Text style={{ padding: 16, color: colors.muted }}>
        No rejected hoses on this verification, so there is nothing to reject.
      </Text>
    );
  }
  const parentIssued =
    (record.state === 'SIGNED' || record.state === 'SYNCED') && Boolean(v.certificateNumber);

  const seal = async () => {
    if (!identity) return;
    if (!parentIssued) {
      Alert.alert(
        'Verification not issued yet',
        'The verification certificate must be sealed first. The rejection certificate arises from it.',
      );
      return;
    }
    if (!marksObliterated || !rejectionMarkApplied || !nozzleSwitchRemoved) {
      Alert.alert(
        'Confirmations required',
        'Confirm all three physical rejection steps before sealing (PROC02 5.5).',
      );
      return;
    }
    setBusy(true);
    try {
      const dispenserId = v.dispenser!.dispenserId;
      const disp = await fetchThrough(`dispenser:${dispenserId}`, () =>
        getDispenser(accessToken, dispenserId),
      );
      const profile = getProfile(identity.subject);
      const rejection: RejectionCertificate = rejectionCertificateSchema.parse({
        schemaVersion: 1,
        // Placeholder scheme pending the QM's word on FM19 numbering.
        rejectionNumber: `${v.certificateNumber}-REJ`,
        parentCertificateNumber: v.certificateNumber,
        siteId: disp.siteId,
        site: v.site,
        dispenser: v.dispenser,
        rejectedHoses: rejectedIdx.map((i) => ({
          hoseNumber: v.hoses![i].hoseNumber,
          product: v.hoses![i].product,
          reasons: [
            ...deriveReasons(v, i),
            ...(extra[i]?.trim() ? [extra[i].trim()] : []),
          ],
        })),
        confirmations: {
          marksObliterated: true,
          rejectionMarkApplied: true,
          nozzleSwitchRemoved: true,
        },
        vo: {
          identity,
          pliersNumber:
            profile.pliersNumber || v.signOff?.vo?.pliersNumber || '',
        },
        rejectionDate: new Date().toISOString().slice(0, 10),
      });

      const pdf = await renderRejectionPdf(rejection);
      const response = await submitRejectionForSigning(
        accessToken,
        {
          documentType: 'rejection-certificate',
          idempotencyKey: idempotencyKey.current,
          rejection,
          pdfSha256: pdf.sha256,
          pdfBase64: pdf.base64,
          intentToSign: {
            deviceTimestamp: new Date().toISOString(),
            deviceId: await getDeviceId(),
          },
        },
        await buildDeviceAuth(pdf.sha256),
      );
      const uri = await persistSignedPdf(response.certificateNumber, response.signedPdfBase64);
      setIssuedUri(uri);
      setIssuedNumber(response.certificateNumber);
    } catch (err) {
      Alert.alert(
        'Could not seal the rejection certificate',
        'Sealing needs a connection.\n\n' + (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (issuedUri && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(issuedUri, { mimeType: 'application/pdf' });
    }
  };

  if (issuedUri) {
    return (
      <FormScrollView>
        <SectionCard title={issuedNumber ?? 'Rejection certificate'}>
          <Badge text="✓ Rejection certificate sealed" tone="ok" />
          <Text style={{ color: colors.ink, fontSize: 13, marginTop: 8 }}>
            Sealed, archived, and attached to this site and dispenser's history. Share it with
            the user of the instrument now; the NRCS copy is forwarded per procedure.
          </Text>
          <Button title="Share sealed rejection certificate" onPress={() => void share()} />
        </SectionCard>
      </FormScrollView>
    );
  }

  return (
    <FormScrollView>
      <SectionCard title="Rejection certificate">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 6 }}>
          Arises from {v.certificateNumber ?? 'this verification'}. The instrument may not be
          used until repaired and verified. Reasons below are derived from the recorded
          evidence; add anything the evidence does not show.
        </Text>
        {rejectedIdx.map((i) => (
          <View key={i} style={{ borderTopWidth: 1, borderColor: colors.line, paddingVertical: 8 }}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>
              Hose / Pump {v.hoses![i].hoseNumber} · {v.hoses![i].product}
            </Text>
            {deriveReasons(v, i).map((r, j) => (
              <Text key={j} style={{ color: colors.ink, fontSize: 12, marginTop: 2 }}>
                • {r}
              </Text>
            ))}
            <TextInput
              style={[inputStyle, { marginTop: 6 }]}
              placeholder="Additional reason (optional)"
              value={extra[i] ?? ''}
              onChangeText={(t) => setExtra((p) => ({ ...p, [i]: t }))}
            />
          </View>
        ))}
      </SectionCard>

      <SectionCard title="Physical steps (PROC02 5.5)">
        {(
          [
            ['Verification / repair marks permanently obliterated', marksObliterated, setMarksObliterated],
            ['Rejection mark applied to the instrument', rejectionMarkApplied, setRejectionMarkApplied],
            ['Nozzle switch removed (instrument unusable)', nozzleSwitchRemoved, setNozzleSwitchRemoved],
          ] as const
        ).map(([label, value, setter]) => (
          <View
            key={label}
            style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 4 }}
          >
            <Text style={{ flex: 1, fontSize: 13, color: colors.ink }}>{label}</Text>
            <Switch value={value} onValueChange={setter} />
          </View>
        ))}
      </SectionCard>

      <View style={{ marginHorizontal: 12 }}>
        <Button title="Seal rejection certificate" onPress={() => void seal()} busy={busy} />
      </View>
    </FormScrollView>
  );
}

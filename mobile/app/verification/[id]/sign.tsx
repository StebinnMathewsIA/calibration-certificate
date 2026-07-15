import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import type { AnalysisResponse, Verification } from '@prowalco/schema';
import { analysisResponseSchema, validateReadyToSign } from '@prowalco/schema';
import { analyzeVerification } from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { Badge, Button, SectionCard, colors, styles } from '../../../src/components/ui';
import { SignaturePad } from '../../../src/components/SignaturePad';
import * as repo from '../../../src/db/certificateRepo';
import { enqueueForSigning } from '../../../src/queue/signQueue';

const VERDICT_TONE = { pass: 'ok', marginal: 'warn', fail: 'bad', data_anomaly: 'bad' } as const;

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: 6,
  paddingHorizontal: 10,
  paddingVertical: 8,
  marginBottom: 8,
  color: colors.ink,
  backgroundColor: '#fff',
} as const;

function plusOneYear(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export default function SignScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { accessToken } = useAuth();
  const record = useMemo(() => repo.getById(id), [id]);
  const initial = record?.form as Verification | undefined;

  const [pliers, setPliers] = useState(initial?.signOff?.vo?.pliersNumber ?? '');
  const [expiry, setExpiry] = useState(initial?.signOff?.expiryDate ?? plusOneYear());
  const [clientName, setClientName] = useState(initial?.signOff?.client?.name ?? '');
  const [rejectionCert, setRejectionCert] = useState(initial?.signOff?.rejectionCertNumber ?? '');
  const [declaration, setDeclaration] = useState(false);
  const [signatureSvg, setSignatureSvg] = useState('');
  const [gpsConsent, setGpsConsent] = useState(true);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(() => {
    const stored = repo.getAnalysis(id);
    return stored ? analysisResponseSchema.parse(JSON.parse(stored)) : null;
  });
  const [analyzing, setAnalyzing] = useState(false);
  const [signing, setSigning] = useState(false);

  if (!record || !initial) return <Text style={{ padding: 16 }}>Not found</Text>;

  const anyRejected = initial.hoses.some((h) => h.outcome === 'rejected');

  const buildVerification = (): Verification => ({
    ...initial,
    signOff: {
      vo: { identity: initial.signOff.vo.identity, pliersNumber: pliers },
      client: { name: clientName },
      declarationAccepted: declaration,
      expiryDate: expiry || undefined,
      rejectionCertNumber: anyRejected ? rejectionCert || undefined : undefined,
    },
  });

  const readiness = validateReadyToSign(buildVerification());

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const response = await analyzeVerification(accessToken, buildVerification());
      setAnalysis(response);
      repo.saveAnalysis(id, JSON.stringify(response));
    } catch (err) {
      Alert.alert(
        'Analysis unavailable',
        'The Claude review could not run (offline or server issue). You can still sign — the review is advisory.\n\n' +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const sign = async () => {
    const verification = buildVerification();
    if (!signatureSvg) {
      Alert.alert('Client signature required', 'Ask the client to sign on the pad before you sign.');
      return;
    }
    repo.saveDraftForm(id, verification);
    setSigning(true);
    try {
      await enqueueForSigning(id, verification, gpsConsent, signatureSvg);
      Alert.alert(
        'Queued for signing',
        'The certificate is saved on this device and will be signed as soon as there is connectivity. It is safe to close the app.',
      );
      router.replace('/home');
    } catch (err) {
      Alert.alert('Could not queue', err instanceof Error ? err.message : String(err));
    } finally {
      setSigning(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <SectionCard title="Sign-off details">
        <Text style={{ fontSize: 12, color: colors.muted }}>VO Pliers No.</Text>
        <TextInput style={inputStyle} value={pliers} onChangeText={setPliers} />
        <Text style={{ fontSize: 12, color: colors.muted }}>Expiry date of certificate (YYYY-MM-DD)</Text>
        <TextInput style={inputStyle} value={expiry} onChangeText={setExpiry} />
        {anyRejected ? (
          <>
            <Text style={{ fontSize: 12, color: colors.muted }}>Rejection Cert. No. (a hose was rejected)</Text>
            <TextInput style={inputStyle} value={rejectionCert} onChangeText={setRejectionCert} />
          </>
        ) : null}
      </SectionCard>

      <SectionCard title="Claude review (advisory)">
        {analysis ? (
          <View>
            <Badge text={analysis.result.verdict.toUpperCase().replace('_', ' ')} tone={VERDICT_TONE[analysis.result.verdict]} />
            <Text style={{ marginTop: 8, color: colors.ink }}>{analysis.result.summary}</Text>
            {analysis.result.concerns.map((c, i) => (
              <Text key={i} style={{ color: colors.amber, marginTop: 4, fontSize: 13 }}>⚠ {c}</Text>
            ))}
            <Button title="Re-run review" onPress={runAnalysis} busy={analyzing} kind="secondary" />
          </View>
        ) : (
          <Button title="Run review" onPress={runAnalysis} busy={analyzing} kind="secondary" />
        )}
      </SectionCard>

      <SectionCard title="Client acknowledgement">
        <Text style={{ fontSize: 12, color: colors.muted }}>Client (Initial &amp; Surname)</Text>
        <TextInput style={inputStyle} value={clientName} onChangeText={setClientName} />
        <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 6 }}>
          Ask the client to sign below. Their signature is embedded in the certificate before your
          cryptographic signature seals it.
        </Text>
        <SignaturePad onChange={setSignatureSvg} />
      </SectionCard>

      <SectionCard title="Verifying Officer declaration">
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <Text style={{ flex: 1, color: colors.ink, fontSize: 13 }}>
            I certify the instrument was tested per the Legal Metrology Act and the procedure was followed.
          </Text>
          <Switch value={declaration} onValueChange={setDeclaration} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <Text style={{ flex: 1, color: colors.ink, fontSize: 13 }}>Record GPS with this signature (POPIA consent)</Text>
          <Switch value={gpsConsent} onValueChange={setGpsConsent} />
        </View>

        {readiness.ready ? (
          <Badge text="READY TO SIGN" tone="ok" />
        ) : (
          <>
            <Badge text="NOT READY" tone="bad" />
            {readiness.reasons.map((r, i) => (
              <Text key={i} style={{ color: colors.red, marginTop: 6, fontSize: 12 }}>• {r}</Text>
            ))}
          </>
        )}
        <Button title="Sign certificate" onPress={sign} busy={signing} disabled={!readiness.ready} />
      </SectionCard>
    </ScrollView>
  );
}

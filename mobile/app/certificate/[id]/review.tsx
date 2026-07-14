import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, Switch, Text, View } from 'react-native';
import type { AnalysisResponse, CalibrationForm } from '@prowalco/schema';
import { analysisResponseSchema, validateReadyToSign } from '@prowalco/schema';
import { analyzeCalibration } from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { Badge, Button, SectionCard, colors, styles } from '../../../src/components/ui';
import * as repo from '../../../src/db/certificateRepo';
import { enqueueForSigning } from '../../../src/queue/signQueue';

const VERDICT_TONE = {
  pass: 'ok',
  marginal: 'warn',
  fail: 'bad',
  data_anomaly: 'bad',
} as const;

export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { accessToken } = useAuth();
  const record = useMemo(() => repo.getById(id), [id]);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(() => {
    const stored = repo.getAnalysis(id);
    return stored ? analysisResponseSchema.parse(JSON.parse(stored)) : null;
  });
  const [analyzing, setAnalyzing] = useState(false);
  const [signing, setSigning] = useState(false);
  const [gpsConsent, setGpsConsent] = useState(true);

  if (!record) return <Text>Not found</Text>;
  const form = record.form as CalibrationForm;
  const readiness = validateReadyToSign(form);

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      // Advisory review BEFORE signing so the technician can react on-site.
      const response = await analyzeCalibration(accessToken, form);
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
    setSigning(true);
    try {
      await enqueueForSigning(id, form, gpsConsent);
      Alert.alert(
        'Queued for signing',
        'The certificate package is saved on this device and will be signed as soon as there is connectivity. It is safe to close the app.',
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
      <SectionCard title={`Certificate ${form.job?.certificateNumber ?? ''}`}>
        {readiness.ready ? (
          <Badge text="READY TO SIGN" tone="ok" />
        ) : (
          <>
            <Badge text="NOT READY" tone="bad" />
            {readiness.reasons.map((r, i) => (
              <Text key={i} style={{ color: colors.red, marginTop: 6, fontSize: 13 }}>
                • {r}
              </Text>
            ))}
            <Button title="Back to form" kind="secondary" onPress={() => router.back()} />
          </>
        )}
      </SectionCard>

      <SectionCard title="Claude review (advisory)">
        <Text style={{ color: colors.muted, marginBottom: 8, fontSize: 13 }}>
          An automated metrology review of the results. The verdict is advisory and is recorded in
          the audit trail — you and the technical signatory remain responsible for the certificate.
        </Text>
        {analysis ? (
          <View>
            <Badge
              text={analysis.result.verdict.toUpperCase().replace('_', ' ')}
              tone={VERDICT_TONE[analysis.result.verdict]}
            />
            <Text style={{ marginTop: 8, color: colors.ink }}>{analysis.result.summary}</Text>
            {analysis.result.concerns.map((c, i) => (
              <Text key={i} style={{ color: colors.amber, marginTop: 4, fontSize: 13 }}>
                ⚠ {c}
              </Text>
            ))}
            {analysis.result.recommendations.map((r, i) => (
              <Text key={i} style={{ color: colors.blue, marginTop: 4, fontSize: 13 }}>
                → {r}
              </Text>
            ))}
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 8 }}>
              {analysis.model} · {analysis.promptVersion} · {analysis.analyzedAt}
            </Text>
          </View>
        ) : (
          <Button title="Run review" onPress={runAnalysis} busy={analyzing} kind="secondary" />
        )}
        {analysis ? (
          <Button title="Re-run review" onPress={runAnalysis} busy={analyzing} kind="secondary" />
        ) : null}
      </SectionCard>

      <SectionCard title="Sign">
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <Text style={{ flex: 1, color: colors.ink, fontSize: 13 }}>
            Record GPS location with this signature (POPIA consent)
          </Text>
          <Switch value={gpsConsent} onValueChange={setGpsConsent} />
        </View>
        <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 4 }}>
          Signing re-confirms your identity (biometric/PIN), renders the certificate PDF on this
          device, and queues it for digital signing. If you are offline, the package uploads
          automatically when connectivity returns — it is issued exactly once.
        </Text>
        <Button title="Sign certificate" onPress={sign} busy={signing} disabled={!readiness.ready} />
      </SectionCard>
    </ScrollView>
  );
}

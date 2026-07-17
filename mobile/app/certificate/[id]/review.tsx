import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, Switch, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { AnalysisResponse, CalibrationForm } from '@prowalco/schema';
import {
  TOLERANCE_CLASSES,
  analysisResponseSchema,
  validateReadyToSign,
} from '@prowalco/schema';
import { analyzeCalibration } from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { Badge, Button, SectionCard, colors, styles } from '../../../src/components/ui';
import * as repo from '../../../src/db/certificateRepo';
import { certificateHtml } from '../../../src/pdf/certificateHtml';
import { enqueueForSigning } from '../../../src/queue/signQueue';

const VERDICT_TONE = {
  pass: 'ok',
  marginal: 'warn',
  fail: 'bad',
  data_anomaly: 'bad',
} as const;

function DigestRow({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', marginBottom: 4 }}>
      <Text style={{ width: 130, color: colors.muted, fontSize: 13 }}>{k}</Text>
      <Text style={{ flex: 1, color: bad ? colors.red : colors.ink, fontSize: 13, fontWeight: bad ? '700' : '400' }}>
        {v}
      </Text>
    </View>
  );
}

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

  const form = record ? (record.form as CalibrationForm) : null;
  const readiness = useMemo(
    () => (form ? validateReadyToSign(form) : { ready: false, reasons: [] }),
    [form],
  );

  // Digest + preview render only for a complete form: the certificate
  // template formats numbers (toFixed) and assumes every field is present.
  const digest = useMemo(() => {
    if (!form || !readiness.ready) return null;
    const rows = [
      ...form.results.asFound.map((r, i) => ({ r, label: `as-found point ${i + 1}` })),
      ...(form.results.asLeft ?? []).map((r, i) => ({ r, label: `as-left point ${i + 1}` })),
    ];
    let worst: { label: string; r: (typeof rows)[number]['r']; usage: number } | null = null;
    for (const { r, label } of rows) {
      const mpe = TOLERANCE_CLASSES[r.toleranceClassId]?.mpePercent;
      const usage = mpe ? Math.abs(r.errorPercent) / mpe : 0;
      if (!worst || usage > worst.usage) worst = { label, r, usage };
    }
    return { points: rows.length, fails: rows.filter((x) => !x.r.pass).length, worst };
  }, [form, readiness.ready]);

  const previewHtml = useMemo(() => {
    if (!form || !readiness.ready) return null;
    // The template targets A4 print (~794 CSS px wide); scale it down to
    // phone width and let the technician pinch-zoom into the detail.
    return certificateHtml(form).replace(
      '<head>',
      '<head><meta name="viewport" content="width=794, initial-scale=0.48, minimum-scale=0.3, maximum-scale=3" />',
    );
  }, [form, readiness.ready]);

  if (!record || !form) return <Text>Not found</Text>;

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
      router.replace({ pathname: '/certificate/[id]/queued', params: { id } });
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

      {digest ? (
        <SectionCard title="Summary — what you are signing">
          <DigestRow k="Customer" v={form.job.customerName} />
          <DigestRow k="Site" v={form.job.siteAddress} />
          <DigestRow k="Unit under test" v={`${form.uut.manufacturer} ${form.uut.modelNumber} · S/N ${form.uut.serialNumber}`} />
          <DigestRow k="Test points" v={String(digest.points)} />
          <DigestRow
            k="Out of tolerance"
            v={digest.fails === 0 ? 'None' : `${digest.fails} point(s) FAIL`}
            bad={digest.fails > 0}
          />
          {digest.worst ? (
            <DigestRow
              k="Worst error"
              v={`${digest.worst.r.errorMl.toFixed(1)} mL (${digest.worst.r.errorPercent.toFixed(3)} %) — ${Math.round(digest.worst.usage * 100)}% of tolerance, ${digest.worst.label}`}
              bad={!digest.worst.r.pass}
            />
          ) : null}
          <DigestRow k="Adjustment" v={form.results.adjustmentPerformed ? 'Performed (as-left results included)' : 'Not performed'} />
        </SectionCard>
      ) : null}

      {previewHtml ? (
        <SectionCard title="Certificate preview">
          <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 6 }}>
            This is the document that will carry your digital signature. Pinch to zoom.
          </Text>
          <View style={{ height: 460, borderWidth: 1, borderColor: colors.line, borderRadius: 6, overflow: 'hidden' }}>
            <WebView source={{ html: previewHtml }} originWhitelist={['*']} setSupportMultipleWindows={false} />
          </View>
        </SectionCard>
      ) : null}

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
        <Button
          title="Sign with biometrics / PIN"
          onPress={sign}
          busy={signing}
          disabled={!readiness.ready}
        />
      </SectionCard>
    </ScrollView>
  );
}

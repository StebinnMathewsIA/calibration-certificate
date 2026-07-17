import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Switch, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { AnalysisResponse, Verification } from '@prowalco/schema';
import { MPE_PERCENT, analysisResponseSchema, validateReadyToSign } from '@prowalco/schema';
import { ApiError, analyzeVerification } from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { Badge, Button, DateInput, SectionCard, colors } from '../../../src/components/ui';
import { FormScrollView } from '../../../src/components/FormScrollView';
import { readCache } from '../../../src/db/cache';
import * as repo from '../../../src/db/certificateRepo';
import { certificateHtml } from '../../../src/pdf/certificateHtml';
import { certificateName, getProfile } from '../../../src/profile/profileStore';
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
  const { accessToken, identity } = useAuth();
  const record = useMemo(() => repo.getById(id), [id]);
  const initial = record?.form as Verification | undefined;
  // The VO's saved profile (name, pliers no, signature) prefills the sign-off.
  const profile = useMemo(() => getProfile(identity?.subject ?? ''), [identity?.subject]);

  const [pliers, setPliers] = useState(
    initial?.signOff?.vo?.pliersNumber || profile.pliersNumber || '',
  );
  const [expiry, setExpiry] = useState(initial?.signOff?.expiryDate ?? plusOneYear());
  const [clientName, setClientName] = useState(initial?.signOff?.client?.name ?? '');
  const [rejectionCert, setRejectionCert] = useState(initial?.signOff?.rejectionCertNumber ?? '');
  const [declaration, setDeclaration] = useState(false);
  const [signatureSvg, setSignatureSvg] = useState('');
  const [gpsConsent, setGpsConsent] = useState(true);

  // The client signature is captured on a dedicated screen and stashed in the
  // cache; pick it up whenever we return here.
  useFocusEffect(
    useCallback(() => {
      const svg = readCache<string>(`signature:${id}`);
      if (svg) setSignatureSvg(svg);
    }, [id]),
  );
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(() => {
    const stored = repo.getAnalysis(id);
    return stored ? analysisResponseSchema.parse(JSON.parse(stored)) : null;
  });
  const [analyzing, setAnalyzing] = useState(false);
  const [signing, setSigning] = useState(false);

  if (!record || !initial) return <Text style={{ padding: 16 }}>Not found</Text>;

  const anyRejected = initial.hoses.some((h) => h.outcome === 'rejected');

  // Digest of what is being certified: per-hose outcome + the delivery that
  // uses the most of the ±MPE band.
  const digest = (() => {
    const deliveries = initial.hoses.flatMap((h) =>
      h.deliveries
        .filter((d) => d.efdPercent != null && !Number.isNaN(d.efdPercent))
        .map((d) => ({ hose: h.hoseNumber, d })),
    );
    let worst: (typeof deliveries)[number] | null = null;
    for (const entry of deliveries) {
      if (!worst || Math.abs(entry.d.efdPercent) > Math.abs(worst.d.efdPercent)) worst = entry;
    }
    return {
      rejected: initial.hoses.filter((h) => h.outcome === 'rejected').length,
      hoses: initial.hoses.length,
      worst,
    };
  })();

  const buildVerification = (): Verification => ({
    ...initial,
    signOff: {
      vo: {
        // The certificate's VO field is "Initial & Surname" (e.g. "S. Mathews").
        identity: {
          ...initial.signOff.vo.identity,
          name: certificateName(profile, initial.signOff.vo.identity.name),
        },
        pliersNumber: pliers,
      },
      client: { name: clientName },
      declarationAccepted: declaration,
      expiryDate: expiry || undefined,
      rejectionCertNumber: anyRejected ? rejectionCert || undefined : undefined,
    },
  });

  const readiness = validateReadyToSign(buildVerification());

  // Preview of the document that will carry the signatures. A4 landscape
  // (~1123 CSS px wide) scaled to phone width; pinch to zoom into detail.
  const previewHtml = readiness.ready
    ? certificateHtml(buildVerification(), {
        customerSignatureSvg: signatureSvg || undefined,
        voSignatureSvg: profile.signatureSvg,
      }).replace(
        '<head>',
        '<head><meta name="viewport" content="width=1123, initial-scale=0.34, minimum-scale=0.2, maximum-scale=3" />',
      )
    : null;

  const [autoNote, setAutoNote] = useState<string | null>(null);

  const runAnalysis = async (auto = false) => {
    setAnalyzing(true);
    setAutoNote(null);
    try {
      // The advisory review only judges the measurement data. Fill the sign-off
      // with valid placeholders so an unfinished signature/declaration never
      // blocks it — the real sign-off is validated at signing time.
      const base = buildVerification();
      const forReview: Verification = {
        ...base,
        signOff: {
          vo: { identity: base.signOff.vo.identity, pliersNumber: pliers || 'PENDING' },
          client: { name: clientName || 'Pending' },
          declarationAccepted: true,
          expiryDate: base.signOff.expiryDate,
          rejectionCertNumber: base.signOff.rejectionCertNumber,
        },
      };
      const response = await analyzeVerification(accessToken, forReview);
      setAnalysis(response);
      repo.saveAnalysis(id, JSON.stringify(response));
    } catch (err) {
      const incomplete = err instanceof ApiError && err.status === 422;
      if (auto) {
        // The auto-run must never interrupt the signing flow with a dialog —
        // the review is advisory. Degrade to an inline note.
        setAutoNote(
          incomplete
            ? 'The automatic review needs complete results — go back and fill every delivery and checklist item.'
            : 'The automatic review could not run (offline or server issue) — you can still sign, or try again.',
        );
      } else {
        Alert.alert(
          incomplete ? 'Results incomplete' : 'Analysis unavailable',
          incomplete
            ? 'Go back and complete every delivery reading and checklist item, then run the review.'
            : 'The Claude review could not run (offline or server issue). You can still sign — the review is advisory.\n\n' +
                (err instanceof Error ? err.message : String(err)),
        );
      }
    } finally {
      setAnalyzing(false);
    }
  };

  // Run the review unprompted the first time this screen opens — an optional
  // button gets skipped; feedback that just appears gets read.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current || analysis || analyzing) return;
    autoRan.current = true;
    void runAnalysis(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doSign = async () => {
    const verification = buildVerification();
    if (!signatureSvg) {
      Alert.alert('Client signature required', 'Ask the client to sign on the pad before you sign.');
      return;
    }
    repo.saveDraftForm(id, verification);
    setSigning(true);
    try {
      await enqueueForSigning(id, verification, gpsConsent, {
        customerSignatureSvg: signatureSvg,
        voSignatureSvg: profile.signatureSvg,
      });
      router.replace({ pathname: '/verification/[id]/queued', params: { id } });
    } catch (err) {
      Alert.alert('Could not queue', err instanceof Error ? err.message : String(err));
    } finally {
      setSigning(false);
    }
  };

  const sign = () => {
    // Gentle friction, never a block: the verdict is advisory and the VO
    // remains responsible (quality procedure).
    const verdict = analysis?.result.verdict;
    if (verdict === 'fail' || verdict === 'data_anomaly') {
      const top = analysis?.result.concerns[0] ?? analysis?.result.summary ?? '';
      Alert.alert(
        `Claude review verdict: ${verdict.replace('_', ' ')}`,
        `${top}\n\nThe review is advisory — you remain responsible as the Verifying Officer. Sign anyway?`,
        [
          { text: 'Not yet', style: 'cancel' },
          { text: 'Sign anyway', style: 'destructive', onPress: () => void doSign() },
        ],
      );
      return;
    }
    void doSign();
  };

  return (
    <FormScrollView>
      <SectionCard title="What you are certifying">
        <Text style={{ color: colors.ink, fontWeight: '600' }}>
          {initial.site?.customerName} · {initial.site?.siteName}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 13 }}>
          {initial.dispenser?.makeModel} · S/N {initial.dispenser?.serialNumber}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <Badge
            filled
            text={digest.rejected > 0 ? `${digest.rejected} OF ${digest.hoses} HOSE(S) REJECTED` : `ALL ${digest.hoses} HOSE(S) CERTIFIED`}
            tone={digest.rejected > 0 ? 'bad' : 'ok'}
          />
        </View>
        {digest.worst ? (
          <Text
            style={{
              color: digest.worst.d.pass ? colors.muted : colors.red,
              fontSize: 13,
              marginTop: 6,
            }}
          >
            Worst EFD: {digest.worst.d.efdPercent.toFixed(2)} % on hose {digest.worst.hose} —{' '}
            {Math.round((Math.abs(digest.worst.d.efdPercent) / MPE_PERCENT) * 100)}% of the ±
            {MPE_PERCENT} % MPE
          </Text>
        ) : null}
      </SectionCard>

      <SectionCard title="Sign-off details">
        <Text style={{ fontSize: 12, color: colors.muted }}>VO Pliers No.</Text>
        <TextInput style={inputStyle} value={pliers} onChangeText={setPliers} />
        <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 3 }}>
          Expiry date of certificate
        </Text>
        <View style={{ marginBottom: 8 }}>
          <DateInput value={expiry} onChange={setExpiry} />
        </View>
        {anyRejected ? (
          <>
            <Text style={{ fontSize: 12, color: colors.muted }}>Rejection Cert. No. (a hose was rejected)</Text>
            <TextInput style={inputStyle} value={rejectionCert} onChangeText={setRejectionCert} />
          </>
        ) : null}
      </SectionCard>

      <SectionCard title="Reference proving measures">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
          Attached to this verification; an expired measure blocks signing.
        </Text>
        {(initial.referenceMeasures ?? []).map((m) => {
          const today = new Date().toISOString().slice(0, 10);
          const soon = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
          const expired = m.expiryDate < today;
          const dueSoon = !expired && m.expiryDate <= soon;
          return (
            <View
              key={`${m.size}-${m.serialNumber}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                borderTopWidth: 1,
                borderColor: colors.line,
                paddingVertical: 6,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.ink, fontWeight: '600', fontSize: 13 }}>
                  {m.size} proving measure · {m.serialNumber}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  cert {m.certificateNumber} · expires {m.expiryDate}
                </Text>
              </View>
              {expired ? (
                <Badge filled text="EXPIRED" tone="bad" />
              ) : dueSoon ? (
                <Badge text="DUE SOON" tone="warn" />
              ) : (
                <Badge text="IN DATE" tone="ok" />
              )}
            </View>
          );
        })}
      </SectionCard>

      <SectionCard title="Claude review (advisory)">
        {analyzing && !analysis ? (
          <View style={{ paddingVertical: 12, alignItems: 'center' }}>
            <ActivityIndicator color={colors.green} />
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 8 }}>
              Reviewing the results…
            </Text>
          </View>
        ) : analysis ? (
          <View>
            <Badge
              filled
              text={analysis.result.verdict.toUpperCase().replace('_', ' ')}
              tone={VERDICT_TONE[analysis.result.verdict]}
            />
            <Text style={{ marginTop: 8, color: colors.ink }}>{analysis.result.summary}</Text>
            {analysis.result.concerns.map((c, i) => (
              <Text key={i} style={{ color: colors.amber, marginTop: 4, fontSize: 13 }}>⚠ {c}</Text>
            ))}
            {analysis.result.concerns.length > 0 ? (
              <Text
                style={{ color: colors.blue, fontSize: 13, fontWeight: '600', marginTop: 6 }}
                onPress={() =>
                  router.push({ pathname: '/verification/[id]/results', params: { id } })
                }
              >
                Back to results →
              </Text>
            ) : null}
            <Button title="Re-run review" onPress={() => runAnalysis()} busy={analyzing} kind="secondary" />
          </View>
        ) : (
          <View>
            {autoNote ? (
              <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 6 }}>{autoNote}</Text>
            ) : null}
            <Button title="Run review" onPress={() => runAnalysis()} busy={analyzing} kind="secondary" />
          </View>
        )}
      </SectionCard>

      <SectionCard title="Client acknowledgement">
        <Text style={{ fontSize: 12, color: colors.muted }}>Client (Initial &amp; Surname)</Text>
        <TextInput style={inputStyle} value={clientName} onChangeText={setClientName} />
        <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 8 }}>
          The client draws their signature on a separate screen; it is embedded in the certificate
          before your signature seals it.
        </Text>
        <Badge
          text={signatureSvg ? 'Signature captured ✓' : 'No signature yet'}
          tone={signatureSvg ? 'ok' : 'warn'}
        />
        <Button
          title={signatureSvg ? 'Re-capture client signature' : 'Capture client signature'}
          kind="secondary"
          onPress={() =>
            router.push({
              pathname: '/signature',
              params: {
                cacheKey: `signature:${id}`,
                title: 'Client signature',
                hint: 'Hand the device to the client and ask them to sign in the box below.',
              },
            })
          }
        />
      </SectionCard>

      {previewHtml ? (
        <SectionCard title="Certificate preview">
          <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 6 }}>
            This is the document that will carry the signatures. Pinch to zoom.
          </Text>
          <View
            style={{
              height: 420,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            <WebView
              source={{ html: previewHtml }}
              originWhitelist={['*']}
              setSupportMultipleWindows={false}
            />
          </View>
        </SectionCard>
      ) : null}

      <SectionCard title="Verifying Officer signature">
        <View
          style={{
            borderWidth: 1.5,
            borderColor: declaration ? colors.green : colors.amber,
            borderRadius: 8,
            padding: 10,
            marginBottom: 10,
            backgroundColor: declaration ? '#f2f8f3' : '#fff8ec',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, color: colors.ink, fontSize: 13, fontWeight: '600' }}>
              I certify the instrument was tested per the Legal Metrology Act and the procedure was
              followed.
            </Text>
            <Switch
              value={declaration}
              onValueChange={setDeclaration}
              trackColor={{ false: colors.amber, true: colors.green }}
              ios_backgroundColor={colors.amber}
              thumbColor="#ffffff"
            />
          </View>
          {!declaration ? (
            <Text style={{ color: colors.amber, fontSize: 12, marginTop: 6 }}>
              Turn this on to certify — required before you can sign.
            </Text>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <Text style={{ flex: 1, color: colors.ink, fontSize: 13 }}>Record GPS with this signature (POPIA consent)</Text>
          <Switch
            value={gpsConsent}
            onValueChange={setGpsConsent}
            trackColor={{ false: colors.muted, true: colors.green }}
            ios_backgroundColor={colors.muted}
            thumbColor="#ffffff"
          />
        </View>

        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>
          Tapping “Sign certificate” confirms your identity with Face ID / passcode and applies your
          legal digital signature — this is the VO signature.
        </Text>

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
        <Button
          title="Sign with Face ID / passcode"
          onPress={sign}
          busy={signing}
          disabled={!readiness.ready}
        />
      </SectionCard>
    </FormScrollView>
  );
}

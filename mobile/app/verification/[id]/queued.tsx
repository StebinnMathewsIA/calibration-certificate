import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import type { CertificateState } from '@prowalco/schema';
import { useAuth } from '../../../src/auth/AuthContext';
import { Button, SectionCard, colors, styles } from '../../../src/components/ui';
import * as repo from '../../../src/db/certificateRepo';
import { processQueue } from '../../../src/queue/signQueue';

/** Order-tracking view of the sign queue for one verification. */
const STEPS: { label: string; detail: string; states: CertificateState[] }[] = [
  {
    label: 'Queued on this device',
    detail: 'Package saved durably — survives app restarts and airplane mode.',
    states: ['QUEUED_FOR_SIGNING'],
  },
  {
    label: 'Uploading',
    detail: 'Sending the package to the signing service.',
    states: ['UPLOADING'],
  },
  {
    label: 'Digitally signed',
    detail: 'PAdES signature and trusted timestamp applied; PDF verified on device.',
    states: ['SIGNED'],
  },
  {
    label: 'Synced to audit log',
    detail: 'Server confirmed the audit record. All done.',
    states: ['SYNCED'],
  },
];

function stepIndex(state: CertificateState | undefined): number {
  return STEPS.findIndex((s) => state != null && s.states.includes(state));
}

export default function QueuedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { accessToken } = useAuth();
  const [record, setRecord] = useState(() => repo.getById(id));

  // Kick a drain immediately (the background runner's safety interval is
  // 60 s) and poll local state while this screen is visible. Concurrent
  // drains are safe: UPLOADING items are skipped and retries are idempotent.
  useEffect(() => {
    processQueue(accessToken).catch(() => {});
    const interval = setInterval(() => setRecord(repo.getById(id)), 1500);
    return () => clearInterval(interval);
  }, [id, accessToken]);

  if (!record) return <Text style={{ padding: 16 }}>Not found</Text>;

  const current = stepIndex(record.state);
  const done = record.state === 'SIGNED' || record.state === 'SYNCED';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <SectionCard title={`Certificate ${record.certificateNumber ?? ''}`}>
        {STEPS.map((step, i) => {
          const reached = i < current;
          const active = i === current;
          const color =
            reached || (active && done) ? colors.green : active ? colors.amber : colors.muted;
          return (
            <View key={step.label} style={{ flexDirection: 'row', marginBottom: 12 }}>
              <View style={{ width: 28, alignItems: 'center' }}>
                {active && !done ? (
                  <ActivityIndicator size="small" color={colors.amber} />
                ) : (
                  <Text style={{ fontSize: 16, color }}>
                    {reached || (active && done) ? '✓' : '○'}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: active ? '700' : '400', color }}>{step.label}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{step.detail}</Text>
              </View>
            </View>
          );
        })}

        {!done ? (
          <Text style={{ color: colors.muted, fontSize: 13 }}>
            It is safe to close the app or keep working — signing finishes automatically when there
            is connectivity, and the certificate is issued exactly once.
          </Text>
        ) : null}

        {record.lastError ? (
          <Text style={{ color: colors.amber, fontSize: 13, marginTop: 8 }}>
            Last attempt: {record.lastError} — retrying automatically.
          </Text>
        ) : null}
      </SectionCard>

      <View style={{ marginHorizontal: 12 }}>
        {done ? (
          <Button
            title="View issued certificate"
            onPress={() => router.replace({ pathname: '/verification/[id]/issued', params: { id } })}
          />
        ) : null}
        <Button title="Back to work orders" kind="secondary" onPress={() => router.replace('/home')} />
      </View>
    </ScrollView>
  );
}

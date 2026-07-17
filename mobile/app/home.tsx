import { Redirect, Stack, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import type { CalibrationForm, CertificateState } from '@prowalco/schema';
import { reserveCertificateNumber } from '../src/api/client';
import { useAuth } from '../src/auth/AuthContext';
import { SyncBanner } from '../src/components/SyncBanner';
import { Badge, Button, colors, styles } from '../src/components/ui';
import { config } from '../src/config';
import * as repo from '../src/db/certificateRepo';
import { processQueue } from '../src/queue/signQueue';

const STATE_TONE: Record<CertificateState, 'ok' | 'warn' | 'bad' | 'muted'> = {
  DRAFT: 'muted',
  READY_TO_SIGN: 'warn',
  QUEUED_FOR_SIGNING: 'warn',
  UPLOADING: 'warn',
  SIGNED: 'ok',
  SYNCED: 'ok',
};

/** Home is organised around the day's work, not certificate archaeology. */
const FILTERS: { key: string; label: string; states: CertificateState[] | null }[] = [
  { key: 'all', label: 'All', states: null },
  { key: 'progress', label: 'In progress', states: ['DRAFT', 'READY_TO_SIGN'] },
  { key: 'queue', label: 'Waiting to sign', states: ['QUEUED_FOR_SIGNING', 'UPLOADING'] },
  { key: 'issued', label: 'Issued', states: ['SIGNED', 'SYNCED'] },
];

function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export default function HomeScreen() {
  const { identity, accessToken, loading, signOut } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<repo.CertificateRecord[]>([]);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  useFocusEffect(
    useCallback(() => {
      setItems(repo.listAll());
    }, []),
  );

  const visible = useMemo(() => {
    const states = FILTERS.find((f) => f.key === filter)?.states ?? null;
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (states && !states.includes(item.state)) return false;
      if (!q) return true;
      const form = item.form as Partial<CalibrationForm>;
      const haystack = [
        item.certificateNumber,
        form.job?.customerName,
        form.job?.siteAddress,
        form.uut?.serialNumber,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, filter, query]);

  if (!loading && !identity) return <Redirect href="/" />;

  const newCalibration = async () => {
    if (!identity) return;
    setCreating(true);
    try {
      // Certificate numbers are allocated server-side per branch. Offline
      // pre-allocation of number blocks is a post-PoC item.
      const certificateNumber = await reserveCertificateNumber(accessToken, config.branchCode);
      const id = repo.createDraft(certificateNumber, {
        schemaVersion: 1,
        job: { certificateNumber, calibrationDate: new Date().toISOString().slice(0, 10) } as never,
        signOff: {
          calibratedBy: identity,
          technicalSignatory: { id: '', name: '' },
          declarationAccepted: false,
        } as never,
      });
      router.push({ pathname: '/certificate/[id]/edit', params: { id } });
    } catch (err) {
      Alert.alert(
        'Cannot start a calibration',
        'A certificate number could not be reserved. Check connectivity and try again.\n\n' +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setCreating(false);
    }
  };

  const confirmSignOut = () => {
    // Deliberate two-tap sign-out: a footer mis-tap in the field used to log
    // the technician out mid-shift.
    Alert.alert('Sign out?', 'Drafts and queued certificates stay on this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  const retryItem = async (itemId: string) => {
    repo.clearRetryBackoff(itemId);
    await processQueue(accessToken).catch(() => {});
    setItems(repo.listAll());
  };

  const counts = (states: CertificateState[] | null) =>
    states ? items.filter((i) => states.includes(i.state)).length : items.length;

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={confirmSignOut} hitSlop={8}>
              <Text style={{ color: '#fff', fontSize: 13 }}>Sign out</Text>
            </Pressable>
          ),
        }}
      />
      <SyncBanner onQueueDrained={() => setItems(repo.listAll())} />

      <View style={{ paddingHorizontal: 12, paddingTop: 12 }}>
        <Text style={{ color: colors.muted, fontSize: 13 }}>Signed in as {identity?.name}</Text>
        <Button title="New calibration" onPress={newCalibration} busy={creating} />
        <TextInput
          style={[styles.input, { marginTop: 10 }]}
          placeholder="Search customer, serial or certificate number"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
        <View style={[styles.chipsRow, { marginTop: 10 }]}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={active ? styles.chipTextActive : styles.chipText}>
                  {f.label} ({counts(f.states)})
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <FlatList
        data={visible}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => {
          const form = item.form as Partial<CalibrationForm>;
          return (
            <Pressable
              onPress={() =>
                router.push({
                  pathname:
                    item.state === 'SIGNED' || item.state === 'SYNCED'
                      ? '/certificate/[id]/issued'
                      : item.state === 'QUEUED_FOR_SIGNING' || item.state === 'UPLOADING'
                        ? '/certificate/[id]/queued'
                        : '/certificate/[id]/edit',
                  params: { id: item.id },
                })
              }
            >
              <View style={[styles.card, { flexDirection: 'row', alignItems: 'center' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', color: colors.ink, fontSize: 15 }}>
                    {form.job?.customerName ?? 'New calibration'}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {item.certificateNumber ?? '(no number)'}
                    {form.uut?.serialNumber ? ` · S/N ${form.uut.serialNumber}` : ''}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {form.job?.calibrationDate ?? ''} · edited {timeAgo(item.updatedAt)}
                  </Text>
                  {item.lastError ? (
                    <View style={{ marginTop: 4 }}>
                      <Text style={{ color: colors.red, fontSize: 12 }}>
                        Last attempt failed: {item.lastError}
                      </Text>
                      {item.state === 'QUEUED_FOR_SIGNING' ? (
                        <Pressable onPress={() => retryItem(item.id)} hitSlop={8}>
                          <Text
                            style={{ color: colors.blue, fontWeight: '600', fontSize: 13, marginTop: 2 }}
                          >
                            Retry now
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </View>
                <Badge text={item.state.replaceAll('_', ' ')} tone={STATE_TONE[item.state]} />
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: colors.muted, marginTop: 40 }}>
            {items.length === 0
              ? 'No calibrations yet.'
              : 'Nothing matches this filter or search.'}
          </Text>
        }
      />
    </View>
  );
}

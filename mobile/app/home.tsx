import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import type { CertificateState } from '@prowalco/schema';
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

export default function HomeScreen() {
  const { identity, accessToken, loading, signOut } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<repo.CertificateRecord[]>([]);
  const [creating, setCreating] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setItems(repo.listAll());
    }, []),
  );

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

  const retryItem = async (itemId: string) => {
    repo.clearRetryBackoff(itemId);
    await processQueue(accessToken).catch(() => {});
    setItems(repo.listAll());
  };

  return (
    <View style={styles.screen}>
      <SyncBanner onQueueDrained={() => setItems(repo.listAll())} />
      <View style={{ padding: 12 }}>
        <Text style={{ color: colors.muted }}>Signed in as {identity?.name}</Text>
        <Button title="New calibration" onPress={newCalibration} busy={creating} />
      </View>
      <FlatList
        data={items}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
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
                <Text style={{ fontWeight: '700', color: colors.ink }}>
                  {item.certificateNumber ?? '(no number)'}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {(item.form.job as { customerName?: string } | undefined)?.customerName ?? 'New calibration'}
                </Text>
                {item.lastError ? (
                  <View style={{ marginTop: 4 }}>
                    <Text style={{ color: colors.red, fontSize: 12 }}>
                      Last attempt failed: {item.lastError}
                    </Text>
                    {item.state === 'QUEUED_FOR_SIGNING' ? (
                      <Pressable onPress={() => retryItem(item.id)} hitSlop={8}>
                        <Text style={{ color: colors.blue, fontWeight: '600', fontSize: 13, marginTop: 2 }}>
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
        )}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: colors.muted, marginTop: 40 }}>
            No calibrations yet.
          </Text>
        }
      />
      <View style={{ padding: 12 }}>
        <Button title="Sign out" kind="secondary" onPress={signOut} />
      </View>
    </View>
  );
}

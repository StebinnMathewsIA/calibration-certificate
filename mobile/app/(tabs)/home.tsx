import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import type { CertificateState, Verification } from '@prowalco/schema';
import { listWorkOrders, WorkOrderSummary } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { SyncBanner } from '../../src/components/SyncBanner';
import { fetchThrough } from '../../src/db/cache';
import * as repo from '../../src/db/certificateRepo';
import { processQueue } from '../../src/queue/signQueue';
import { Badge, Button, colors, styles } from '../../src/components/ui';

const IN_PROGRESS_LABEL: Partial<Record<CertificateState, string>> = {
  DRAFT: 'DRAFT',
  READY_TO_SIGN: 'READY TO SIGN',
  QUEUED_FOR_SIGNING: 'QUEUED',
  UPLOADING: 'UPLOADING',
  SIGNED: 'SYNC PENDING',
};

const IN_PROGRESS_TONE: Partial<Record<CertificateState, 'ok' | 'warn' | 'bad' | 'muted'>> = {
  DRAFT: 'muted',
  READY_TO_SIGN: 'warn',
  QUEUED_FOR_SIGNING: 'warn',
  UPLOADING: 'warn',
  SIGNED: 'ok',
};

/** Where tapping an in-progress record resumes. */
function resumePath(state: CertificateState): string {
  if (state === 'QUEUED_FOR_SIGNING' || state === 'UPLOADING') return '/verification/[id]/queued';
  if (state === 'SIGNED' || state === 'SYNCED') return '/verification/[id]/issued';
  return '/verification/[id]/results';
}

export default function HomeScreen() {
  const { identity, accessToken, loading } = useAuth();
  const router = useRouter();
  const [workOrders, setWorkOrders] = useState<WorkOrderSummary[]>([]);
  const [inProgress, setInProgress] = useState<repo.CertificateRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadLocal = useCallback(() => {
    // Every verification on this device that has not fully synced — drafts
    // were previously orphaned the moment the VO left the results screen.
    setInProgress(repo.listAll().filter((r) => r.state !== 'SYNCED'));
  }, []);

  const load = useCallback(async () => {
    setRefreshing(true);
    loadLocal();
    try {
      const wo = await fetchThrough('workorders', () => listWorkOrders(accessToken));
      setWorkOrders(wo);
    } catch {
      // offline with no cache — leave the list empty
    } finally {
      setRefreshing(false);
    }
  }, [accessToken, loadLocal]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const retryItem = async (itemId: string) => {
    repo.clearRetryBackoff(itemId);
    await processQueue(accessToken).catch(() => {});
    loadLocal();
  };

  if (!loading && !identity) return <Redirect href="/" />;

  return (
    <View style={styles.screen}>
      <SyncBanner onQueueDrained={loadLocal} />
      <View style={{ padding: 12 }}>
        <Button
          title={refreshing ? 'Refreshing…' : 'Refresh work orders'}
          kind="secondary"
          onPress={load}
          busy={refreshing}
        />
      </View>
      <FlatList
        data={workOrders}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <>
            {inProgress.length > 0 ? (
              <>
                <Text style={{ marginHorizontal: 12, fontWeight: '700', color: colors.ink }}>
                  In progress on this device
                </Text>
                {inProgress.map((item) => {
                  const v = item.form as Partial<Verification>;
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() =>
                        router.push({ pathname: resumePath(item.state) as never, params: { id: item.id } })
                      }
                    >
                      <View style={[styles.card, { flexDirection: 'row', alignItems: 'center' }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontWeight: '700', color: colors.ink }}>
                            {v.site?.siteName ?? v.site?.customerName ?? 'Verification'}
                          </Text>
                          <Text style={{ color: colors.muted, fontSize: 12 }}>
                            {v.dispenser?.serialNumber ? `S/N ${v.dispenser.serialNumber} · ` : ''}
                            {item.certificateNumber ?? 'number pending'}
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
                        <Badge
                          text={IN_PROGRESS_LABEL[item.state] ?? item.state}
                          tone={IN_PROGRESS_TONE[item.state] ?? 'muted'}
                        />
                      </View>
                    </Pressable>
                  );
                })}
              </>
            ) : null}
            <Text style={{ marginHorizontal: 12, marginTop: 4, fontWeight: '700', color: colors.ink }}>
              My open work orders
            </Text>
          </>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/workorder/[id]', params: { id: item.id } })}
          >
            <View style={[styles.card, { flexDirection: 'row', alignItems: 'center' }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>{item.reference}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {item.site.customerName} · {item.site.siteName}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  {item.dispenserIds.length} dispenser(s)
                  {item.scheduledDate ? ` · ${item.scheduledDate}` : ''}
                </Text>
              </View>
              <Badge text={item.status.replaceAll('_', ' ')} tone="muted" />
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: colors.muted, marginTop: 20 }}>
            No open work orders. Pull refresh when online.
          </Text>
        }
      />
    </View>
  );
}

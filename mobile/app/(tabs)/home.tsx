import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import type { CertificateState, Verification } from '@prowalco/schema';
import { listWorkOrders, WorkOrderSummary } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { TrashIcon } from '../../src/components/BrandHeader';
import { GreetingHeader } from '../../src/components/GreetingHeader';
import { SyncBanner } from '../../src/components/SyncBanner';
import { fetchThrough } from '../../src/db/cache';
import * as repo from '../../src/db/certificateRepo';
import { processQueue } from '../../src/queue/signQueue';
import { Badge, Button, colors, styles } from '../../src/components/ui';

const IN_PROGRESS_LABEL: Partial<Record<CertificateState, string>> = {
  DRAFT: 'Draft',
  READY_TO_SIGN: 'Ready to sign',
  QUEUED_FOR_SIGNING: 'Queued',
  UPLOADING: 'Uploading…',
  SIGNED: 'Sync pending',
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

const recordWorkOrderId = (r: repo.CertificateRecord): string | undefined =>
  (r.form as Partial<Verification>).workOrderId;

/** Editable pre-signing states — the only ones that may be deleted (#41). */
const isDraftState = (s: CertificateState) => s === 'DRAFT' || s === 'READY_TO_SIGN';

/** "Last saved" readout (#40): relative while recent, absolute after a day. */
function formatLastSaved(iso: string): string {
  const saved = new Date(iso);
  const mins = Math.floor((Date.now() - saved.getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const hh = String(saved.getHours()).padStart(2, '0');
  const mm = String(saved.getMinutes()).padStart(2, '0');
  return `${saved.toISOString().slice(0, 10)} ${hh}:${mm}`;
}

export default function HomeScreen() {
  const { identity, accessToken, loading } = useAuth();
  const router = useRouter();
  const [workOrders, setWorkOrders] = useState<WorkOrderSummary[]>([]);
  const [inProgress, setInProgress] = useState<repo.CertificateRecord[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const loadLocal = useCallback(() => {
    // Every verification on this device that has not fully synced — drafts
    // were previously orphaned the moment the VO left the results screen.
    // Most recently worked-on first (#40): autosave touches updatedAt on
    // every field change, so this surfaces the draft the VO was busy with.
    setInProgress(
      repo
        .listAll()
        .filter((r) => r.state !== 'SYNCED')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
    setArchivedCount(repo.listArchived().length);
  }, []);

  const load = useCallback(async () => {
    setRefreshing(true);
    loadLocal();
    try {
      const wo = await fetchThrough('workorders', () => listWorkOrders(accessToken));
      // A work order reported closed archives its local drafts (#31). Only a
      // positive 'completed' status archives — a fetch failure (offline, no
      // cache) reaches the catch below and archives nothing.
      repo.archiveDraftsForClosedWorkOrders(
        wo.filter((w) => w.status === 'completed').map((w) => w.id),
      );
      setWorkOrders(wo.filter((w) => w.status !== 'completed'));
      loadLocal();
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

  const confirmDeleteDraft = (item: repo.CertificateRecord) => {
    const v = item.form as Partial<Verification>;
    const label = v.site?.siteName ?? v.site?.customerName ?? 'This draft';
    Alert.alert(
      'Delete draft?',
      `${label}${item.certificateNumber ? ` (${item.certificateNumber})` : ''} will be removed from this device. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            repo.deleteDraft(item.id);
            loadLocal();
          },
        },
      ],
    );
  };

  // In-progress items grouped under their work order (#30); anything whose
  // work order is not displayed (no id, or no longer assigned) stays in the
  // fallback section so it never disappears.
  const byWorkOrder = useMemo(() => {
    const m = new Map<string, repo.CertificateRecord[]>();
    for (const r of inProgress) {
      const woId = recordWorkOrderId(r);
      if (!woId) continue;
      m.set(woId, [...(m.get(woId) ?? []), r]);
    }
    return m;
  }, [inProgress]);

  const unallocated = useMemo(() => {
    const displayed = new Set(workOrders.map((w) => w.id));
    return inProgress.filter((r) => {
      const woId = recordWorkOrderId(r);
      return !woId || !displayed.has(woId);
    });
  }, [inProgress, workOrders]);

  if (!loading && !identity) return <Redirect href="/" />;

  const inProgressCard = (item: repo.CertificateRecord, nested: boolean) => {
    const v = item.form as Partial<Verification>;
    return (
      <Pressable
        key={item.id}
        onPress={() =>
          router.push({ pathname: resumePath(item.state) as never, params: { id: item.id } })
        }
      >
        <View
          style={[
            styles.card,
            { flexDirection: 'row', alignItems: 'center' },
            nested ? { marginLeft: 28, marginTop: 0 } : null,
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>
              {v.site?.siteName ?? v.site?.customerName ?? 'Verification'}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              {v.dispenser?.serialNumber ? `S/N ${v.dispenser.serialNumber} · ` : ''}
              {item.certificateNumber ?? 'number pending'}
            </Text>
            {isDraftState(item.state) ? (
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                Last saved {formatLastSaved(item.updatedAt)}
              </Text>
            ) : null}
            {item.lastError ? (
              <View style={{ marginTop: 4 }}>
                <Text style={{ color: colors.red, fontSize: 12 }}>
                  Last attempt failed: {item.lastError}
                </Text>
                {item.state === 'QUEUED_FOR_SIGNING' ? (
                  <Pressable onPress={() => retryItem(item.id)} hitSlop={8}>
                    <Text
                      style={{
                        color: colors.blueText,
                        fontWeight: '600',
                        textDecorationLine: 'underline',
                        fontSize: 13,
                        marginTop: 2,
                      }}
                    >
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
          {isDraftState(item.state) ? (
            <Pressable
              onPress={() => confirmDeleteDraft(item)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Delete draft"
              style={{ marginLeft: 12 }}
            >
              <TrashIcon color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.screen}>
      <GreetingHeader
        openWorkOrders={workOrders.length}
        checking={refreshing && workOrders.length === 0}
        onRefresh={load}
        refreshing={refreshing}
      />
      <SyncBanner onQueueDrained={loadLocal} />
      {refreshing ? (
        // The refresh action lives in the header icon (#39); the familiar
        // loading bar still appears here while a refresh is in flight.
        <View style={{ padding: 12 }}>
          <Button title="Refreshing…" kind="secondary" onPress={() => {}} busy />
        </View>
      ) : null}
      <FlatList
        data={workOrders}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ paddingBottom: 120 }}
        ListHeaderComponent={
          <>
            {unallocated.length > 0 ? (
              <>
                <Text style={{ marginHorizontal: 12, fontWeight: '700', color: colors.ink }}>
                  In progress on this device
                </Text>
                {unallocated.map((item) => inProgressCard(item, false))}
              </>
            ) : null}
            <Text style={{ marginHorizontal: 12, marginTop: 4, fontWeight: '700', color: colors.ink }}>
              My open work orders
            </Text>
          </>
        }
        renderItem={({ item }) => (
          <>
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
            {(byWorkOrder.get(item.id) ?? []).map((r) => inProgressCard(r, true))}
          </>
        )}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: colors.muted, marginTop: 20 }}>
            No open work orders. Pull refresh when online.
          </Text>
        }
        ListFooterComponent={
          archivedCount > 0 ? (
            <Text
              style={{ marginHorizontal: 12, marginTop: 16, fontSize: 12, color: colors.muted }}
            >
              {archivedCount} archived draft{archivedCount === 1 ? '' : 's'} from closed work orders
            </Text>
          ) : null
        }
      />
    </View>
  );
}

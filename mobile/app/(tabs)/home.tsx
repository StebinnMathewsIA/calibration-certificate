import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import type { CertificateState, Verification } from '@prowalco/schema';
import {
  TeamGroup,
  WorkOrderRecord,
  getTeamWorkOrders,
  listWorkOrderRecords,
  listWorkOrders,
  WorkOrderSummary,
} from '../../src/api/client';
import { MyDay } from '../../src/components/MyDay';
import { useAuth } from '../../src/auth/AuthContext';
import { TrashIcon } from '../../src/components/BrandHeader';
import { GreetingHeader } from '../../src/components/GreetingHeader';
import { SyncBanner } from '../../src/components/SyncBanner';
import { fetchThrough } from '../../src/db/cache';
import { getProfile } from '../../src/profile/profileStore';
import * as repo from '../../src/db/certificateRepo';
import { processQueue } from '../../src/queue/signQueue';
import { Badge, colors, styles } from '../../src/components/ui';

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

/** Home section order for open work orders — owner-defined OnKey statuses
 * (#55). Work orders with any other/no statusDetail land in "Open". */
const OPEN_SECTION_ORDER = [
  'To be Planned',
  'Allocated',
  'Incomplete for Spares',
  'Work Order Received',
  'Referral',
  'Work Resumed',
];

type HomeListItem = { kind: 'header'; title: string } | { kind: 'wo'; wo: WorkOrderSummary };

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

  // Team view (#76): role holders see every technician's open work orders,
  // collapsible per technician with status groups nested under each.
  const [team, setTeam] = useState<TeamGroup[] | null>(null);
  const [teamOpen, setTeamOpen] = useState<Record<string, boolean>>({});
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchThrough('team-workorders', () => getTeamWorkOrders(accessToken))
        .then((t) => !cancelled && setTeam(t))
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [accessToken]),
  );

  // Certified-measures status (#70): missing/expired blocks verifications,
  // expiring within 30 days warns — surfaced right on Home.
  const measureAlert = useMemo(() => {
    if (!identity) return null;
    const active = getProfile(identity.subject).measures ?? [];
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const missing = ['200L', '20L', '5L'].filter((s) => !active.some((m) => m.size === s));
    const expired = active.filter((m) => m.expiryDate < today);
    const expiring = active.filter((m) => m.expiryDate >= today && m.expiryDate <= soon);
    if (missing.length + expired.length + expiring.length === 0) return null;
    const blocking = missing.length > 0 || expired.length > 0;
    const parts = [
      ...missing.map((s) => `${s} not registered`),
      ...expired.map((m) => `${m.size} expired ${m.expiryDate}`),
      ...expiring.map((m) => `${m.size} expires ${m.expiryDate}`),
    ];
    return { blocking, text: parts.join(' · ') };
  }, [identity, workOrders]);

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

  // Section per OnKey status in the owner-defined order (#55); anything with
  // an unknown/missing statusDetail (e.g. the simulated provider) lands in a
  // plain "Open" section so nothing disappears.
  const sectionedItems = useMemo<HomeListItem[]>(() => {
    const items: HomeListItem[] = [];
    const leftovers = new Set(workOrders.map((w) => w.id));
    for (const title of OPEN_SECTION_ORDER) {
      const inSection = workOrders.filter((w) => w.statusDetail === title);
      if (inSection.length === 0) continue;
      items.push({ kind: 'header', title });
      for (const wo of inSection) {
        items.push({ kind: 'wo', wo });
        leftovers.delete(wo.id);
      }
    }
    const rest = workOrders.filter((w) => leftovers.has(w.id));
    if (rest.length > 0) {
      if (items.length > 0) items.push({ kind: 'header', title: 'Open' });
      for (const wo of rest) items.push({ kind: 'wo', wo });
    }
    return items;
  }, [workOrders]);

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
      {measureAlert ? (
        <Pressable
          onPress={() => router.push('/profile')}
          style={{
            marginHorizontal: 12,
            marginBottom: 8,
            borderRadius: 12,
            borderWidth: 1.5,
            padding: 10,
            borderColor: measureAlert.blocking ? colors.red : colors.amberFill,
            backgroundColor: measureAlert.blocking ? colors.redTint : colors.amberTint,
          }}
        >
          <Text style={{ fontWeight: '700', color: measureAlert.blocking ? colors.red : colors.amber, fontSize: 13 }}>
            {measureAlert.blocking
              ? 'Proving measures — verifications blocked'
              : 'Proving measures expiring soon'}
          </Text>
          <Text style={{ color: colors.ink, fontSize: 12, marginTop: 2 }}>
            {measureAlert.text} — tap to manage your certified measures.
          </Text>
        </Pressable>
      ) : null}
      <FlatList
        ListFooterComponent={
          <View>
          {archivedCount > 0 ? (
            <Text
              style={{ marginHorizontal: 12, marginTop: 16, fontSize: 12, color: colors.muted }}
            >
              {archivedCount} archived draft{archivedCount === 1 ? '' : 's'} from closed work orders
            </Text>
          ) : null}
          {team && team.length > 0 ? (
            <View style={{ marginHorizontal: 12, marginTop: 16, marginBottom: 8 }}>
              <Text style={{ fontWeight: '700', color: colors.ink, fontSize: 15, marginBottom: 4 }}>
                Team work orders
              </Text>
              {team.map((g) => {
                const open = teamOpen[g.staffCode] ?? false;
                const byStatus = new Map<string, WorkOrderSummary[]>();
                for (const wo of g.workOrders) {
                  const k = wo.statusDetail ?? 'Open';
                  const l = byStatus.get(k);
                  if (l) l.push(wo);
                  else byStatus.set(k, [wo]);
                }
                return (
                  <View key={g.staffCode}>
                    <Text
                      onPress={() => setTeamOpen((e) => ({ ...e, [g.staffCode]: !open }))}
                      accessibilityRole="button"
                      style={{
                        paddingVertical: 8,
                        borderTopWidth: 1,
                        borderColor: colors.line,
                        fontWeight: '700',
                        color: colors.ink,
                        fontSize: 14,
                      }}
                    >
                      {open ? '\u25be ' : '\u25b8 '}
                      {g.name ?? g.staffCode}
                      <Text style={{ color: colors.muted, fontWeight: '400', fontSize: 12 }}>
                        {'  '}{g.workOrders.length} open
                      </Text>
                    </Text>
                    {open
                      ? [...byStatus.entries()].map(([status, wos]) => (
                          <View key={status} style={{ marginLeft: 10 }}>
                            <Text
                              style={{
                                color: colors.muted,
                                fontSize: 11,
                                marginTop: 6,
                                textTransform: 'uppercase',
                              }}
                            >
                              {status} ({wos.length})
                            </Text>
                            {wos.map((wo) => (
                              <Text
                                key={wo.id}
                                onPress={() =>
                                  router.push({ pathname: '/workorder/[id]', params: { id: wo.id } })
                                }
                                style={{ color: colors.blueText, fontSize: 13, paddingVertical: 4 }}
                              >
                                {wo.reference} · {wo.site.customerName} {wo.site.siteName}
                                {wo.scheduledDate ? ` · due ${wo.scheduledDate}` : ''}
                              </Text>
                            ))}
                          </View>
                        ))
                      : null}
                  </View>
                );
              })}
            </View>
          ) : null}
          </View>
        }
        data={sectionedItems}
        keyExtractor={(x) => (x.kind === 'header' ? `h:${x.title}` : x.wo.id)}
        // The in-flow tab bar reserves its own space now (#45) — only a
        // small breathing gap is needed.
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <>
            {/* The new work list (#95/#107): our work-order records with
                our lifecycle, ranked and filterable by state. */}
            <MyDay />
            {unallocated.length > 0 ? (
              <>
                <Text style={{ marginHorizontal: 12, fontWeight: '700', color: colors.ink }}>
                  In progress on this device
                </Text>
                {unallocated.map((item) => inProgressCard(item, false))}
              </>
            ) : null}
            <Text style={{ marginHorizontal: 12, marginTop: 4, fontWeight: '700', color: colors.ink }}>
              Verification work (certificates)
            </Text>
          </>
        }
        renderItem={({ item }) =>
          item.kind === 'header' ? (
            // One section per OnKey status, in the owner-defined order (#55).
            <Text
              style={{
                marginHorizontal: 12,
                marginTop: 14,
                marginBottom: 2,
                fontSize: 13,
                fontWeight: '700',
                color: colors.muted,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              {item.title}
            </Text>
          ) : (
            <>
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/workorder/[id]', params: { id: item.wo.id } })
                }
              >
                <View style={[styles.card, { flexDirection: 'row', alignItems: 'center' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', color: colors.ink }}>{item.wo.reference}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      {item.wo.site.customerName} · {item.wo.site.siteName}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      {item.wo.dispenserIds.length} dispenser(s)
                      {item.wo.scheduledDate ? ` · due ${item.wo.scheduledDate}` : ''}
                    </Text>
                  </View>
                  <Badge
                    text={(item.wo.statusDetail ?? item.wo.status).replaceAll('_', ' ')}
                    tone="muted"
                  />
                </View>
              </Pressable>
              {(byWorkOrder.get(item.wo.id) ?? []).map((r) => inProgressCard(r, true))}
            </>
          )
        }
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: colors.muted, marginTop: 20 }}>
            No open work orders. Pull refresh when online.
          </Text>
        }
      />
    </View>
  );
}

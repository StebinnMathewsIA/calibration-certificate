/**
 * Home (#157, the owner-reviewed redesign). Top to bottom: greeting with
 * the device's town, search, the day's four number cards, the date chip
 * beside the map of surrounding work orders, then the work list in three
 * sections: In progress (started, then on the way), Upcoming, Complete
 * and stopped. Below it, everything Home already carried: the measures
 * alert, certificates in progress on this device, and the team section.
 *
 * The map needs the native Google Maps build; until a phone has it, the
 * strip shows a quiet placeholder (see HomeMap for the lazy require).
 */
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { CertificateState, Verification } from '@prowalco/schema';
import {
  HomeStats,
  TeamGroup,
  WorkOrderRecord,
  WorkOrderSummary,
  getHomeStats,
  getTeamWorkOrders,
  listWorkOrderRecords,
  listWorkOrders,
} from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { TrashIcon } from '../../src/components/BrandHeader';
import { GreetingHeader } from '../../src/components/GreetingHeader';
import { SyncBanner } from '../../src/components/SyncBanner';
import { HomeMap, pinsFor } from '../../src/components/home/HomeMap';
import { StatCards } from '../../src/components/home/StatCards';
import { WorkOrderCard, homeSection } from '../../src/components/home/WorkOrderCard';
import { parseWktPoint } from '../../src/components/MiniMap';
import { Badge, colors, fonts, styles } from '../../src/components/ui';
import { fetchThrough, readCache, writeCache } from '../../src/db/cache';
import { onFreshnessSettled } from '../../src/sync/freshness';
import { roadKm } from '../../src/util/geo';
import { getProfile } from '../../src/profile/profileStore';
import * as repo from '../../src/db/certificateRepo';
import { processQueue } from '../../src/queue/signQueue';

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

function resumePath(state: CertificateState): string {
  if (state === 'QUEUED_FOR_SIGNING' || state === 'UPLOADING') return '/verification/[id]/queued';
  if (state === 'SIGNED' || state === 'SYNCED') return '/verification/[id]/issued';
  return '/verification/[id]/results';
}

const isDraftState = (s: CertificateState) => s === 'DRAFT' || s === 'READY_TO_SIGN';

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

function SectionHead({ title, live }: { title: string; live?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginTop: 18 }}>
      {live ? (
        <View
          style={{
            width: 9,
            height: 9,
            borderRadius: 999,
            backgroundColor: colors.green,
          }}
        />
      ) : null}
      <Text style={{ fontFamily: fonts.heading, fontSize: 18, color: colors.ink }}>{title}</Text>
    </View>
  );
}

/** The date chip beside the map, from the mock. */
function DateChip() {
  const now = new Date();
  const dows = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    <View
      style={{
        width: 96,
        borderRadius: 20,
        padding: 12,
        justifyContent: 'center',
        backgroundColor: colors.green,
      }}
    >
      <Text style={{ color: '#fff', fontSize: 12, opacity: 0.9 }}>{dows[now.getDay()]}</Text>
      <Text style={{ color: '#fff', fontFamily: fonts.heading, fontSize: 30, lineHeight: 34 }}>
        {now.getDate()}
      </Text>
      <Text style={{ color: '#fff', fontSize: 12, opacity: 0.9 }}>{months[now.getMonth()]}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const { identity, accessToken, loading } = useAuth();
  const router = useRouter();
  const [records, setRecords] = useState<WorkOrderRecord[] | null>(null);
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrderSummary[]>([]);
  const [inProgress, setInProgress] = useState<repo.CertificateRecord[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const todayStr = new Date().toISOString().slice(0, 10);
  // Dismissible once per day (#157 owner adjustment): the warning stays
  // closed until tomorrow. The BLOCKING variant ignores this, because a
  // hidden reason for a refused verification is worse than a banner.
  const [alertDismissed, setAlertDismissed] = useState<boolean>(
    () => readCache<string>('measures-alert:dismissed') === new Date().toISOString().slice(0, 10),
  );
  const [here, setHere] = useState<{ latitude: number; longitude: number } | null>(null);
  const [town, setTown] = useState<string | null>(null);

  const loadLocal = useCallback(() => {
    setInProgress(
      repo
        .listAll()
        .filter((r) => r.state !== 'SYNCED')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
    setArchivedCount(repo.listArchived().length);
  }, []);

  const loadRecords = useCallback(
    (force = false) => {
      fetchThrough<WorkOrderRecord[]>('wo:records', () => listWorkOrderRecords(accessToken), {
        force,
        onFresh: setRecords,
      })
        .then(setRecords)
        .catch(() => setRecords((r) => r ?? []));
      fetchThrough<HomeStats>('home:stats', () => getHomeStats(accessToken), {
        force,
        onFresh: setStats,
      })
        .then(setStats)
        .catch(() => {});
    },
    [accessToken],
  );

  const load = useCallback(async () => {
    setRefreshing(true);
    loadLocal();
    loadRecords();
    try {
      const wo = await fetchThrough('workorders', () => listWorkOrders(accessToken));
      // A work order reported closed archives its local drafts (#31).
      repo.archiveDraftsForClosedWorkOrders(
        wo.filter((w) => w.status === 'completed').map((w) => w.id),
      );
      setWorkOrders(wo.filter((w) => w.status !== 'completed'));
      loadLocal();
    } catch {
      // offline with no cache
    } finally {
      setRefreshing(false);
    }
  }, [accessToken, loadLocal, loadRecords]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Repaint from the caches the freshness gate just refreshed (#150).
  useEffect(() => onFreshnessSettled(() => loadRecords()), [loadRecords]);

  // Position and town (#157): consented GPS, reverse geocoded by the
  // PLATFORM's own geocoder via expo-location. No Google API involved.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // ASK, not just check (#157 field finding): a fresh install has
        // no grant, and Home only ever checked, so the dot and the town
        // never appeared. The system prompt carries the consent wording
        // from the app config.
        let perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted && perm.canAskAgain) {
          perm = await Location.requestForegroundPermissionsAsync();
        }
        if (!perm.granted) return;
        // Last known fix FIRST (#157 field finding): a fresh GPS fix can
        // take long enough that the dot looked absent. Paint the cached
        // position instantly, then refine with the live one.
        const last = await Location.getLastKnownPositionAsync();
        if (alive && last) {
          setHere({ latitude: last.coords.latitude, longitude: last.coords.longitude });
        }
        const fix = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!alive) return;
        setHere({ latitude: fix.coords.latitude, longitude: fix.coords.longitude });
        const places = await Location.reverseGeocodeAsync(fix.coords);
        const p = places[0];
        if (alive && p) {
          setTown([p.city ?? p.subregion, p.region].filter(Boolean).join(', ') || null);
        }
      } catch {
        // No fix or no geocoder: the header simply shows no town.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Certified-measures status (#70).
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

  // Team view (#76), unchanged.
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

  const sections = useMemo(() => {
    const all = records ?? [];
    const q = query.trim().toLowerCase();
    const match = (w: WorkOrderRecord) =>
      !q ||
      [w.siteName, w.customerName, w.externalRef, w.workRequired]
        .some((f) => (f ?? '').toLowerCase().includes(q));
    const live = all.filter((w) => homeSection(w) === 'live');
    // Started before on the way: the top of the list is what is live NOW.
    live.sort((a, b) => {
      const rank = (w: WorkOrderRecord) => (w.lifecycle?.state === 'started' ? 0 : 1);
      return rank(a) - rank(b);
    });
    const upcoming = all
      .filter((w) => homeSection(w) === 'upcoming' && match(w))
      .sort((a, b) => (a.completeBy ?? '9999').localeCompare(b.completeBy ?? '9999'));
    const done = all
      .filter((w) => homeSection(w) === 'done' && match(w))
      .sort((a, b) =>
        (b.lifecycle?.signedOffAt ?? b.lifecycle?.stoppedAt ?? b.lifecycle?.pausedAt ?? '').localeCompare(
          a.lifecycle?.signedOffAt ?? a.lifecycle?.stoppedAt ?? a.lifecycle?.pausedAt ?? '',
        ),
      );
    return { live, upcoming, done };
  }, [records, query]);

  const openCount = useMemo(
    () => (records ?? []).filter((w) => w.lifecycle?.state !== 'signed_off').length,
    [records],
  );

  const distanceFor = useCallback(
    (wo: WorkOrderRecord): number | null => {
      if (!here) return null;
      const p = parseWktPoint(wo.gpsLocation);
      return p ? roadKm(here, { latitude: p.lat, longitude: p.lon }) : null;
    },
    [here],
  );

  if (!loading && !identity) return <Redirect href="/" />;

  const inProgressCard = (item: repo.CertificateRecord) => {
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
        openWorkOrders={openCount}
        checking={records === null}
        onRefresh={() => {
          loadRecords(true);
          void load();
        }}
        refreshing={refreshing}
      />
      {town ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginHorizontal: 12, marginTop: -4, marginBottom: 4 }}>
          <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
            <Path d="M12 21s-7-5.6-7-11a7 7 0 0 1 14 0c0 5.4-7 11-7 11z" stroke={colors.green} strokeWidth={2.2} />
            <Circle cx={12} cy={10} r={2.4} stroke={colors.green} strokeWidth={2.2} />
          </Svg>
          <Text style={{ fontSize: 12.5, color: colors.muted }}>{town}</Text>
        </View>
      ) : null}
      <SyncBanner onQueueDrained={loadLocal} />
      {measureAlert && (measureAlert.blocking || !alertDismissed) ? (
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
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: measureAlert.blocking ? colors.red : colors.amber, fontSize: 13 }}>
                {measureAlert.blocking
                  ? 'Proving measures: verifications blocked'
                  : 'Proving measures expiring soon'}
              </Text>
              <Text style={{ color: colors.ink, fontSize: 12, marginTop: 2 }}>
                {measureAlert.text}. Tap to manage your certified measures.
              </Text>
            </View>
            {!measureAlert.blocking ? (
              <Pressable
                onPress={() => {
                  writeCache('measures-alert:dismissed', todayStr);
                  setAlertDismissed(true);
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Dismiss until tomorrow"
                style={{ marginLeft: 8, marginTop: 1 }}
              >
                <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 6l12 12M18 6L6 18" stroke={colors.amber} strokeWidth={2.4} strokeLinecap="round" />
                </Svg>
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      ) : null}

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <StatCards stats={stats} />

        <View style={{ flexDirection: 'row', gap: 9, marginHorizontal: 12, marginTop: 10 }}>
          <DateChip />
          <View style={{ flex: 1 }}>
            <HomeMap
              here={here}
              pins={pinsFor((records ?? []).filter((w) => w.lifecycle?.state !== 'signed_off'))}
              onPress={() => router.push('/map')}
            />
          </View>
        </View>

        {sections.live.length > 0 ? (
          <>
            <SectionHead title="In progress" live />
            {sections.live.map((w) => (
              <WorkOrderCard key={w.id} wo={w} distanceKm={distanceFor(w)} />
            ))}
          </>
        ) : null}

        <View style={{ marginTop: 16 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginHorizontal: 12,
            backgroundColor: '#fff',
            borderRadius: 999,
            borderWidth: 1,
            borderColor: colors.line,
            paddingHorizontal: 14,
            paddingVertical: 2,
          }}
        >
          <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
            <Circle cx={11} cy={11} r={7} stroke={colors.muted} strokeWidth={2.2} />
            <Path d="M20 20l-3.6-3.6" stroke={colors.muted} strokeWidth={2.2} strokeLinecap="round" />
          </Svg>
          <TextInput
            style={{ flex: 1, paddingVertical: 8, fontSize: 14, color: colors.ink }}
            placeholder="Search a site or work order"
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
          />
        </View>
        </View>

        {sections.upcoming.length > 0 ? (
          <>
            <SectionHead title="Upcoming" />
            {sections.upcoming.map((w) => (
              <WorkOrderCard key={w.id} wo={w} />
            ))}
          </>
        ) : null}

        {sections.done.length > 0 ? (
          <>
            <SectionHead title="Complete and stopped" />
            {sections.done.map((w) => (
              <WorkOrderCard key={w.id} wo={w} />
            ))}
          </>
        ) : null}

        {records !== null &&
        sections.live.length + sections.upcoming.length + sections.done.length === 0 ? (
          <Text style={{ textAlign: 'center', color: colors.muted, marginTop: 20 }}>
            {query.trim()
              ? 'Nothing matches that search.'
              : 'No open work orders. Pull refresh when online.'}
          </Text>
        ) : null}

        {inProgress.length > 0 ? (
          <Text
            style={{
              marginHorizontal: 12,
              marginTop: 18,
              fontFamily: fonts.heading,
              color: colors.ink,
              fontSize: 18,
            }}
          >
            Certificates in progress on this device
          </Text>
        ) : null}
        {inProgress.map((item) => inProgressCard(item))}
        {archivedCount > 0 ? (
          <Text style={{ marginHorizontal: 12, marginTop: 16, fontSize: 12, color: colors.muted }}>
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
                    {open ? '▾ ' : '▸ '}
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
      </ScrollView>
    </View>
  );
}

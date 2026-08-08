/**
 * "My day" (#95): the technician's work, ranked and filterable by
 * lifecycle state. This is the new home of the work list: our own
 * work-order records with our lifecycle, seeded from OnKey.
 *
 * Filters follow FR-WL-03 (All / Not started / In progress / Done) with
 * live counts; the ranking underneath is the advisory one (#107).
 */
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { WorkOrderRecord, listWorkOrderRecords } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { fetchThrough } from '../db/cache';
import { rankWorkOrders, type Ranked } from '../scheduling/rank';
import { Badge, colors, fonts } from './ui';

type Filter = 'all' | 'not_started' | 'active' | 'done';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'not_started', label: 'Not started' },
  { key: 'active', label: 'In progress' },
  { key: 'done', label: 'Done' },
];

const STATE_BADGE: Record<string, { text: string; tone: 'ok' | 'warn' | 'muted' }> = {
  on_the_way: { text: 'On the way', tone: 'ok' },
  started: { text: 'In progress', tone: 'ok' },
  paused: { text: 'Paused', tone: 'warn' },
  stopped: { text: 'Stopped', tone: 'ok' },
  signed_off: { text: 'Signed off', tone: 'ok' },
};

/** Signed off, and therefore in "Completed today" rather than in the live
 * list. The server only returns work signed off since midnight, so this
 * needs no date arithmetic: being here at all means today (#126). */
const isCompleted = (r: Ranked): boolean => r.wo.lifecycle?.state === 'signed_off';

const matches = (r: Ranked, f: Filter): boolean => {
  const s = r.wo.lifecycle?.state ?? 'not_started';
  // "All" means all the LIVE work. Completed jobs have their own section,
  // and showing them in both places would double the count.
  if (f === 'all') return !isCompleted(r);
  if (f === 'not_started') return s === 'not_started';
  // Travelling to a job counts as being on it.
  if (f === 'active') return s === 'on_the_way' || s === 'started' || s === 'paused';
  return s === 'stopped' || s === 'signed_off';
};

export function MyDay({
  onCount,
  refreshSignal = 0,
}: {
  onCount?: (n: number) => void;
  /** Bumped by Home's refresh button to force a network read. */
  refreshSignal?: number;
} = {}) {
  const { accessToken } = useAuth();
  const router = useRouter();
  const [ranked, setRanked] = useState<Ranked[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [showAll, setShowAll] = useState(false);
  // Held in a ref so an inline callback from the parent cannot re-create
  // `load` on every render and put useFocusEffect in a loop.
  const onCountRef = useRef(onCount);
  useEffect(() => {
    onCountRef.current = onCount;
  }, [onCount]);

  const load = useCallback(
    async (force = false) => {
      let here: { latitude: number; longitude: number } | null = null;
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.granted) {
          const fix = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          here = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
        }
      } catch {
        // Ranking still works on urgency alone without a fix.
      }
      const apply = (list: WorkOrderRecord[]) => {
        const r = rankWorkOrders(list, here);
        setRanked(r);
        // The greeting's count comes from HERE, not from a second query,
        // and counts the same thing the list shows: work still to do.
        // Counting the raw list said "3 open work orders" above a list of
        // 2, because the completed one was in one count and not the other.
        onCountRef.current?.(r.filter((x) => !isCompleted(x)).length);
      };
      try {
        const list = await fetchThrough<WorkOrderRecord[]>(
          'wo:records',
          () => listWorkOrderRecords(accessToken),
          // The cached list paints immediately; `onFresh` repaints the
          // moment the server answers, so a planner's change lands in the
          // same visit rather than the next one.
          { force, onFresh: apply },
        );
        apply(list);
      } catch {
        setRanked([]);
        onCountRef.current?.(0);
      }
    },
    [accessToken],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // The header refresh button drives this, so pulling to refresh actually
  // goes to the network instead of re-reading the same cache.
  useEffect(() => {
    if (refreshSignal) void load(true);
  }, [refreshSignal, load]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, not_started: 0, active: 0, done: 0 };
    for (const r of ranked ?? []) {
      c.all += 1;
      for (const f of ['not_started', 'active', 'done'] as Filter[]) {
        if (matches(r, f)) c[f] += 1;
      }
    }
    return c;
  }, [ranked]);

  if (!ranked || ranked.length === 0) return null;
  const visible = ranked.filter((r) => matches(r, filter));
  const shown = showAll ? visible : visible.slice(0, 4);
  const completed = ranked.filter(isCompleted);

  return (
    <View style={{ marginHorizontal: 12, marginBottom: 12 }}>
      <Text style={{ fontWeight: '700', color: colors.ink, fontSize: 16, marginBottom: 8 }}>
        My day
      </Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <Text
              key={f.key}
              onPress={() => setFilter(f.key)}
              accessibilityRole="button"
              accessibilityLabel={`Show ${f.label} work orders`}
              style={{
                borderWidth: 1,
                borderColor: on ? colors.navy : colors.line,
                backgroundColor: on ? colors.navy : '#fff',
                color: on ? '#fff' : colors.ink,
                paddingHorizontal: 11,
                paddingVertical: 5,
                borderRadius: 999,
                overflow: 'hidden',
                fontSize: 12,
                fontWeight: '600',
              }}
            >
              {f.label} {counts[f.key]}
            </Text>
          );
        })}
      </View>

      {shown.length === 0 ? (
        <Text style={{ color: colors.muted, fontSize: 12 }}>Nothing in this view.</Text>
      ) : null}

      {shown.map((r, i) => {
        const badge = STATE_BADGE[r.wo.lifecycle?.state ?? 'not_started'];
        const first = filter === 'all' && i === 0 && !showAll;
        // The list is ordered by status, so say where each group starts.
        // An order nobody can see reads as no order at all.
        const groupOf = (x: Ranked) =>
          x.stage <= 3
            ? (STATE_BADGE[x.wo.lifecycle?.state ?? '']?.text ?? 'In hand')
            : (x.wo.statusDescription ?? 'Open');
        const groupLabel =
          i === 0 || groupOf(shown[i - 1]) !== groupOf(r) ? groupOf(r) : null;
        return (
          <React.Fragment key={r.wo.id}>
          {groupLabel ? (
            <Text
              style={{
                color: colors.muted,
                fontSize: 11,
                fontWeight: '700',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginTop: i === 0 ? 0 : 10,
                marginBottom: 4,
              }}
            >
              {groupLabel}
            </Text>
          ) : null}
          <Pressable
            onPress={() => router.push({ pathname: '/wo/[id]', params: { id: r.wo.id } })}
            style={{
              borderWidth: first ? 1.5 : 1,
              borderColor: r.overdue ? colors.red : first ? colors.navy : colors.line,
              backgroundColor: r.overdue ? colors.redTint : colors.card,
              borderRadius: 12,
              padding: 11,
              marginBottom: 7,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {first ? <Badge text="Start next" tone="ok" /> : null}
              <Text style={{ flex: 1, fontWeight: '700', color: colors.ink, fontSize: 14 }}>
                {r.wo.siteName ?? r.wo.externalRef}
              </Text>
              {badge ? <Badge text={badge.text} tone={badge.tone} /> : null}
            </View>
            <Text style={{ color: colors.ink, fontSize: 12, marginTop: 3 }} numberOfLines={2}>
              {r.wo.workRequired}
            </Text>
            <Text
              style={{
                color: r.overdue ? colors.red : colors.muted,
                fontSize: 11,
                marginTop: 3,
                fontFamily: fonts.body,
                fontWeight: r.overdue ? '700' : '400',
              }}
            >
              {[r.wo.externalRef, r.why].filter(Boolean).join(' · ')}
            </Text>
          </Pressable>
          </React.Fragment>
        );
      })}

      {visible.length > 4 ? (
        <Text
          onPress={() => setShowAll(!showAll)}
          accessibilityRole="button"
          style={{ color: colors.blueText, fontSize: 12, marginTop: 2 }}
        >
          {showAll ? 'Show fewer' : `Show all ${visible.length}`}
        </Text>
      ) : null}

      {/* Completed today (#126). Defined by a timestamp, not a flag, so it
          empties itself at midnight and nobody has to clear it. Rendered
          only under "All": the Done chip already shows the same jobs in the
          list above, and printing them twice would be its own confusion. */}
      {filter === 'all' && completed.length > 0 ? (
        <View style={{ marginTop: 14 }}>
          <Text
            style={{
              color: colors.muted,
              fontSize: 12,
              fontFamily: fonts.bodyMedium,
              letterSpacing: 0.6,
              marginBottom: 6,
            }}
          >
            COMPLETED TODAY
          </Text>
          {completed.map((r) => (
            <Pressable
              key={r.wo.id}
              onPress={() => router.push({ pathname: '/wo/[id]', params: { id: r.wo.id } })}
              accessibilityRole="button"
              accessibilityLabel={`Completed: ${r.wo.siteName ?? r.wo.externalRef ?? 'work order'}`}
              style={{
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: 12,
                paddingVertical: 10,
                paddingHorizontal: 12,
                marginBottom: 6,
                backgroundColor: '#fff',
                opacity: 0.85,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text
                  style={{ flex: 1, color: colors.ink, fontSize: 14, fontFamily: fonts.bodyMedium }}
                  numberOfLines={1}
                >
                  {r.wo.siteName ?? r.wo.externalRef}
                </Text>
                <Badge text="Signed off" tone="ok" />
              </View>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                {r.wo.externalRef}
                {r.wo.lifecycle?.signedOffAt
                  ? ` · ${r.wo.lifecycle.signedOffAt.slice(11, 16)}`
                  : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

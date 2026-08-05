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
  started: { text: 'In progress', tone: 'ok' },
  paused: { text: 'Paused', tone: 'warn' },
  stopped: { text: 'Stopped', tone: 'ok' },
  signed_off: { text: 'Signed off', tone: 'ok' },
};

const matches = (r: Ranked, f: Filter): boolean => {
  const s = r.wo.lifecycle?.state ?? 'not_started';
  if (f === 'all') return true;
  if (f === 'not_started') return s === 'not_started';
  if (f === 'active') return s === 'started' || s === 'paused';
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
        setRanked(rankWorkOrders(list, here));
        // The greeting's count comes from HERE, not from a second query.
        // Home used to count OnKey's open statuses while this list counted
        // our work-order records, so the header said 2 above a list of 4.
        onCountRef.current?.(list.length);
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
        const groupLabel =
          i === 0 || shown[i - 1].wo.statusDescription !== r.wo.statusDescription
            ? (r.wo.statusDescription ?? 'Open')
            : null;
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
    </View>
  );
}

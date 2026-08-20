/**
 * Work order detail (#159): one page, three states, in the Home card
 * language.
 *
 * ON THE WAY (and before): the brief. The hero card with the full work
 * required, distance to site, the styled map with a Navigate handoff,
 * dispensers, and past work at this site.
 *
 * STARTED (and paused): the work. The job card's fields live ON the
 * page, and Complete and Pause are LOCKED until the required entries
 * exist (owner rule): a visit carrying labour or distance, and the work
 * performed written. Pause accepts a partial note.
 *
 * COMPLETE (stopped, signed off): the outcome. Work performed as the
 * card, the figures, the itemised spares, the signed job card as a PDF,
 * and past work at the site.
 *
 * The lifecycle state machine stays server-enforced; this screen
 * presents it (#95). Dispenser scope is never forced: an OnKey-named
 * asset is highlighted, the whole site stays in scope (#159).
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Alert, Linking, Pressable, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import {
  DispenserResolved,
  JobCardBundle,
  JobCardPart,
  JobCardVisit,
  PastSiteWork,
  PauseReason,
  WoDivergence,
  WorkOrderRecord,
  acknowledgeDivergence,
  fetchJobCardTasks,
  getJobCard,
  getPastSiteWork,
  listDivergence,
  listPauseReasons,
  listSiteDispensers,
  listWorkOrderRecords,
  saveJobCard,
  standDownWorkOrder,
  transitionWorkOrder,
} from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { Badge, Button, SectionCard, colors, fonts } from '../../src/components/ui';
import { FormScrollView } from '../../src/components/FormScrollView';
import { LifecycleActions } from '../../src/components/LifecycleActions';
import { HomeMap, pinsFor } from '../../src/components/home/HomeMap';
import { OilDisc } from '../../src/components/home/OilDisc';
import { parseWktPoint } from '../../src/components/MiniMap';
import { fetchThrough, readCache, writeCache } from '../../src/db/cache';
import { rejectedTransitions } from '../../src/sync/outbox';
import { formatDay, formatDuration, overdueDays } from '../../src/util/format';
import { formatKm, roadKm } from '../../src/util/geo';

/** Same cache key My day reads. The two MUST agree: this screen used to
 * fetch the list itself, so a failed request left it on "Loading..."
 * forever under a list that had rendered from cache. */
const WO_CACHE_KEY = 'wo:records';

/** Said plainly, because the technician may be standing on the forecourt
 * when they read it. */
const DIVERGENCE_TITLE: Record<string, string> = {
  recalled_while_in_hand: 'Planning has taken this back',
  closed_while_in_hand: 'The office has closed this',
  write_not_reflected: 'The office has not received your update',
  write_dead_lettered: 'Your update could not be sent',
};

const DIVERGENCE_BODY: Record<string, string> = {
  recalled_while_in_hand:
    'The planning team moved this job off you after you picked it up. Call the office before you carry on, or before you drive any further.',
  closed_while_in_hand:
    'This job was closed in OnKey while you still had it open. Anything you record now may not be counted. Call the office.',
  write_not_reflected:
    'We sent your status change to OnKey and it is still not showing there. The office may not know where this job stands.',
  write_dead_lettered:
    'Your status change could not be delivered to OnKey after several attempts. The office does not have it.',
};

/** Net working minutes: wall clock since start minus completed pauses. */
function minutesOnJob(wo: WorkOrderRecord): number {
  const l = wo.lifecycle;
  if (!l?.startedAt) return 0;
  const end = l.stoppedAt ? new Date(l.stoppedAt).getTime() : Date.now();
  const gross = (end - new Date(l.startedAt).getTime()) / 1000;
  return Math.max(0, Math.round((gross - (l.pausedSeconds ?? 0)) / 60));
}

/** OnKey folds the previous work order's identity into the work required
 * text as a Last_Work_Order line. Split it off and prettify: the data is
 * kept, the underscores are not (#159). */
function splitWorkRequired(text: string | null): { main: string | null; note: string | null } {
  if (!text) return { main: null, note: null };
  const at = text.search(/Last[_ ]Work[_ ]Order:/i);
  if (at < 0) return { main: text.trim() || null, note: null };
  const main = text.slice(0, at).trim() || null;
  const note = text
    .slice(at)
    .replace(/Last[_ ]Work[_ ]Order:\s*/i, 'Previous work order ')
    .replaceAll('_', ' ')
    .trim();
  return { main, note: note || null };
}

const num = (s: string): number => {
  const n = Number(String(s).replace(',', '.').trim());
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

const blankVisit = (): JobCardVisit => ({
  date: new Date().toISOString().slice(0, 10),
  distanceKm: 0,
  labourHours: 0,
  labourOt15Hours: 0,
  labourOt20Hours: 0,
});

function MetaCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, width: '48%' }}>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          backgroundColor: colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 11.5, color: colors.muted }}>{label}</Text>
        <Text
          style={{ fontSize: 13.5, color: colors.ink, fontFamily: fonts.bodyMedium, fontVariant: ['tabular-nums'] }}
          numberOfLines={1}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

const ClockIcon = (
  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
    <Circle cx={12} cy={12} r={8.5} stroke={colors.navy} strokeWidth={2} />
    <Path d="M12 7.5V12l3 2" stroke={colors.navy} strokeWidth={2} strokeLinecap="round" />
  </Svg>
);
const TimerIcon = (
  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
    <Path d="M10 2h4M12 8v5l2.5 2" stroke={colors.navy} strokeWidth={2} strokeLinecap="round" />
    <Circle cx={12} cy={14} r={7.5} stroke={colors.navy} strokeWidth={2} />
  </Svg>
);
const RoadIcon = (
  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
    <Path d="M5 21L9 3M19 21L15 3M12 5v2.5M12 11v2.5M12 17v2.5" stroke={colors.navy} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const BoxIcon = (
  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
    <Path d="M3.5 8l8.5-4.5L20.5 8v8L12 20.5 3.5 16z" stroke={colors.navy} strokeWidth={1.9} strokeLinejoin="round" />
    <Path d="M3.5 8L12 12.5 20.5 8M12 12.5v8" stroke={colors.navy} strokeWidth={1.9} strokeLinejoin="round" />
  </Svg>
);
const CalendarIcon = (
  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
    <Path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" stroke={colors.navy} strokeWidth={2} strokeLinecap="round" />
    <Path d="M4 8a2.5 2.5 0 0 1 2.5-2.5h11A2.5 2.5 0 0 1 20 8v10a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18z" stroke={colors.navy} strokeWidth={2} />
  </Svg>
);

/** Status at the hero's top right: the Home card's icon language. */
function HeroStatus({ wo }: { wo: WorkOrderRecord }) {
  const state = wo.lifecycle?.state ?? 'not_started';
  if (state === 'started') {
    return (
      <View
        accessibilityLabel={`In progress, ${formatDuration(minutesOnJob(wo)) ?? '0 min'} on job`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          backgroundColor: colors.blueTint,
          borderRadius: 999,
          paddingVertical: 6,
          paddingHorizontal: 11,
        }}
      >
        <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
          <Path d="M8 5.5v13l10-6.5z" stroke={colors.blueText} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
        <Text style={{ color: colors.blueText, fontSize: 12.5, fontFamily: fonts.bodyMedium, fontVariant: ['tabular-nums'] }}>
          {formatDuration(minutesOnJob(wo)) ?? '0 min'}
        </Text>
      </View>
    );
  }
  const disc = (bg: string, child: React.ReactNode, label: string) => (
    <View
      accessibilityLabel={label}
      style={{ width: 32, height: 32, borderRadius: 999, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}
    >
      {child}
    </View>
  );
  if (state === 'on_the_way') {
    return disc(
      colors.blueTint,
      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
        <Path d="M21 3L10.5 13.5M21 3l-7 18-3.5-7.5L3 10z" stroke={colors.blueText} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>,
      'On the way',
    );
  }
  if (state === 'paused') {
    return disc(
      colors.mist,
      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
        <Path d="M9 5v14M15 5v14" stroke={colors.muted} strokeWidth={2.6} strokeLinecap="round" />
      </Svg>,
      'Paused',
    );
  }
  if (state === 'stopped' || state === 'signed_off') {
    return disc(
      state === 'signed_off' ? colors.greenTint : colors.mist,
      <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
        <Path
          d="M4 12.5l5 5L20 6.5"
          stroke={state === 'signed_off' ? colors.greenText : colors.muted}
          strokeWidth={2.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>,
      state === 'signed_off' ? 'Signed off' : 'Complete, awaiting sign off',
    );
  }
  return (
    <View
      accessibilityLabel="Not started"
      style={{ width: 32, height: 32, borderRadius: 999, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.line }}
    />
  );
}

export default function WorkOrderLifecycleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { accessToken } = useAuth();
  const [wo, setWo] = useState<WorkOrderRecord | null>(null);
  const [reasons, setReasons] = useState<PauseReason[]>([]);
  const [pausing, setPausing] = useState(false);
  const [chosenReason, setChosenReason] = useState<PauseReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rejected, setRejected] = useState<{ event: string; error: string }[]>([]);
  const [divergence, setDivergence] = useState<WoDivergence | null>(null);
  const [dispensers, setDispensers] = useState<DispenserResolved[] | null>(null);
  const [dispensersFailed, setDispensersFailed] = useState(false);
  const [past, setPast] = useState<PastSiteWork[]>([]);
  const [here, setHere] = useState<{ latitude: number; longitude: number } | null>(null);

  // The inline job card (#159): the fields the gate reads, on the page.
  const [bundle, setBundle] = useState<JobCardBundle | null>(null);
  const [visits, setVisits] = useState<JobCardVisit[]>([]);
  const [parts, setParts] = useState<JobCardPart[]>([]);
  const [performed, setPerformed] = useState('');
  const dirty = React.useRef(false);

  // The play pill ticks by the minute while started.
  const [, bump] = useState(0);
  const state = wo?.lifecycle?.state ?? 'not_started';
  React.useEffect(() => {
    if (state !== 'started') return;
    const t = setInterval(() => bump((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [state]);

  // The fetch the card was always waiting for (#143), keyed on the site.
  const siteId = wo?.siteId ?? null;
  React.useEffect(() => {
    if (!siteId) return;
    let alive = true;
    setDispensersFailed(false);
    fetchThrough(`site-dispensers:${siteId}`, () => listSiteDispensers(accessToken, siteId), {
      onFresh: (list) => alive && setDispensers(list),
    })
      .then((list) => alive && setDispensers(list))
      .catch(() => {
        if (alive) setDispensersFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [accessToken, siteId]);

  const load = useCallback(() => {
    setLoadState((s) => (s === 'ready' ? s : 'loading'));
    fetchThrough<WorkOrderRecord[]>(WO_CACHE_KEY, () => listWorkOrderRecords(accessToken), {
      onFresh: (list) => {
        const found = list.find((w) => w.id === id) ?? null;
        setWo(found);
        setLoadState(found ? 'ready' : 'missing');
      },
    })
      .then((list) => {
        const found = list.find((w) => w.id === id) ?? null;
        setWo(found);
        setLoadState(found ? 'ready' : 'missing');
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoadState('error');
      });
    fetchThrough('wo:pause-reasons', () => listPauseReasons(accessToken))
      .then(setReasons)
      .catch(() => {});
    fetchThrough('wo:divergence', () => listDivergence(accessToken), {
      onFresh: (list) => setDivergence(list.find((d) => d.workOrderId === id) ?? null),
    })
      .then((list) => setDivergence(list.find((d) => d.workOrderId === id) ?? null))
      .catch(() => {});
    getPastSiteWork(accessToken, String(id))
      .then(setPast)
      .catch(() => {});
    setRejected(
      rejectedTransitions()
        .filter((r) => r.workOrderId === id)
        .map((r) => ({ event: r.event, error: r.error })),
    );
  }, [accessToken, id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Position for the distance cell and the map dot: last known first.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted && perm.canAskAgain) {
          perm = await Location.requestForegroundPermissionsAsync();
        }
        if (!perm.granted) return;
        const last = await Location.getLastKnownPositionAsync();
        if (alive && last) {
          setHere({ latitude: last.coords.latitude, longitude: last.coords.longitude });
        }
        const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (alive) setHere({ latitude: fix.coords.latitude, longitude: fix.coords.longitude });
      } catch {
        // No fix: no distance cell, the map frames the site alone.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // The job card rides along from started onward (#159). Reloaded on
  // EVERY focus, not just mount (#190): the spares page edits the same
  // job card, and a mount-only fetch meant returning from it showed the
  // stale list, whose autosave then overwrote the booking. Parts are
  // taken from the server unconditionally, because this page has no
  // parts editor and therefore no local parts edits to protect; visits
  // and work performed keep the dirty guard.
  const phase: 'pre' | 'active' | 'done' =
    state === 'started' || state === 'paused' ? 'active' : state === 'stopped' || state === 'signed_off' ? 'done' : 'pre';
  const applyBundle = useCallback((b: JobCardBundle) => {
    setBundle(b);
    setParts(b.jobCard?.parts ?? []);
    if (!dirty.current) {
      setVisits(b.jobCard?.visits?.length ? b.jobCard.visits : [blankVisit()]);
      setPerformed(b.jobCard?.workPerformed ?? '');
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (phase === 'pre') return;
      getJobCard(accessToken, String(id), { onFresh: applyBundle })
        .then(applyBundle)
        .catch(() => {});
    }, [accessToken, id, phase, applyBundle]),
  );

  // Ask OnKey for the work tasks when the bundle carries none (#152).
  // Once per screen visit, in the background; the result lands in the
  // cached bundle so the next open, online or not, has them.
  const taskFetchTried = React.useRef(false);
  React.useEffect(() => {
    if (phase === 'pre' || !bundle || taskFetchTried.current) return;
    if ((bundle.tasks ?? []).length > 0) return;
    taskFetchTried.current = true;
    fetchJobCardTasks(accessToken, String(id))
      .then((out) => {
        if (out.tasks.length === 0) return;
        setBundle((prev) => {
          if (!prev) return prev;
          const next = { ...prev, tasks: out.tasks };
          writeCache(`jobcard:${id}`, next);
          return next;
        });
      })
      .catch(() => {});
  }, [phase, bundle, accessToken, id]);

  const persist = useCallback(
    (over: Partial<{ visits: JobCardVisit[]; parts: JobCardPart[]; workPerformed: string }> = {}) => {
      void saveJobCard(accessToken, String(id), {
        visits,
        parts,
        workPerformed: performed,
        ...over,
      }).catch(() => {});
    },
    [accessToken, id, visits, parts, performed],
  );

  // THE GATE (#159, #162, #165, owner rule): Complete needs a visit
  // carrying labour or distance and the work performed written; with the
  // gate satisfied, Complete OPENS THE SIGN-OFF, because sign-off and
  // completion are one act: the client's signature finishes the job.
  // Pause needs at least a partial work performed note.
  const visitOk = visits.some(
    (v) => (v.labourHours ?? 0) > 0 || (v.distanceKm ?? 0) > 0 || (v.labourOt15Hours ?? 0) > 0 || (v.labourOt20Hours ?? 0) > 0,
  );
  const performedOk = performed.trim().length > 0;
  const signed = bundle?.jobCard?.state === 'signed';
  const completeGateOk = visitOk && performedOk;
  const gateNote =
    phase === 'active' && !completeGateOk ? 'Fill the job card first' : null;

  const elapsed = useMemo(() => (wo && minutesOnJob(wo) > 0 ? formatDuration(minutesOnJob(wo)) : null), [wo, state]);

  // Hooks stop here: everything below the load-state returns must be
  // plain values, or the hook count changes between renders and React
  // throws (owner hit this on device, 2026-08-16).
  const jcTotals = useMemo(() => {
    const src = bundle?.jobCard?.visits ?? visits;
    const sum = (k: keyof JobCardVisit) => src.reduce((n, v) => n + (Number(v[k]) || 0), 0);
    const partsSrc = bundle?.jobCard?.parts ?? parts;
    return {
      km: sum('distanceKm'),
      hours: sum('labourHours') + sum('labourOt15Hours') + sum('labourOt20Hours'),
      spares: partsSrc.reduce((n, p) => n + (Number(p.quantity) || 0), 0),
      items: partsSrc,
    };
  }, [bundle, visits, parts]);

  if (loadState === 'loading') {
    return <Text style={{ padding: 16, color: colors.muted }}>Loading…</Text>;
  }

  if (loadState !== 'ready' || !wo) {
    return (
      <FormScrollView>
        <SectionCard
          title={loadState === 'missing' ? 'Not in your work list' : 'Could not load your work'}
        >
          <Text style={{ color: colors.ink, fontSize: 14 }}>
            {loadState === 'missing'
              ? 'This work order is not in the list on this device. It may have been reassigned, closed, or issued to a different technician since the list was last synced.'
              : 'Your work orders could not be fetched. Check your signal and try again.'}
          </Text>
          {loadError ? (
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>{loadError}</Text>
          ) : null}
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6, fontFamily: fonts.mono }}>
            {id}
          </Text>
          <Button title="Try again" onPress={load} />
          <Button title="Back to my day" kind="secondary" onPress={() => router.back()} />
        </SectionCard>
      </FormScrollView>
    );
  }

  const apply = async (
    event: 'on_the_way' | 'start' | 'pause' | 'stop' | 'sign_off',
    opts: { reason?: string; note?: string } = {},
  ): Promise<boolean> => {
    setBusy(true);
    try {
      let gps: string | undefined;
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.granted) {
          const fix = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          gps = `POINT (${fix.coords.longitude} ${fix.coords.latitude})`;
        }
      } catch {
        // no fix, carry on
      }
      const updated = await transitionWorkOrder(accessToken, wo.id, event, { ...opts, gps });
      setWo(updated);
      const cached = readCache<WorkOrderRecord[]>(WO_CACHE_KEY);
      if (cached) {
        writeCache(
          WO_CACHE_KEY,
          cached.map((w) => (w.id === updated.id ? updated : w)),
        );
      }
      setPausing(false);
      setChosenReason(null);
      setNote('');
      return true;
    } catch (err) {
      Alert.alert('Could not update the work order', err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const confirmStandDown = () => {
    Alert.alert(
      'Cannot get there?',
      'This job goes back to your list as not started, and nothing is sent to the office. You can pick it up again later.',
      [
        { text: 'Keep going', style: 'cancel' },
        {
          text: 'Cannot get there',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            standDownWorkOrder(accessToken, String(id))
              .then((updated) => {
                setWo(updated);
                router.back();
              })
              .catch((err) =>
                Alert.alert('Could not stand down', err instanceof Error ? err.message : String(err)),
              )
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  };

  const confirmPause = () => {
    if (!chosenReason) {
      Alert.alert('Reason required', 'Choose why the work order is being paused.');
      return;
    }
    if (chosenReason.requiresNote && !note.trim()) {
      Alert.alert('Description required', 'This reason needs a short description.');
      return;
    }
    if (chosenReason.blocksResume) {
      Alert.alert(
        'This cannot be resumed',
        `Pausing for "${chosenReason.label}" hands the work order back: you will not be able to resume it yourself. The client then signs the incomplete job card.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Pause and sign off',
            style: 'destructive',
            onPress: () => {
              void apply('pause', { reason: chosenReason.code, note: note.trim() }).then((ok) => {
                // The client signs the incomplete card while the
                // technician is still on site (#166). Sealing a blocked
                // pause records their acknowledgement and books the
                // costing; the job stays with the office.
                if (ok && !signed) {
                  router.push({ pathname: '/signoff/[id]', params: { id: String(id) } });
                }
              });
            },
          },
        ],
      );
      return;
    }
    void apply('pause', { reason: chosenReason.code, note: note.trim() });
  };

  /** The gate speaks when a locked verb is tapped (#159): the exact
   * missing pieces, not a dead button. */
  const gateRefusal = (verb: 'stop' | 'pause'): boolean => {
    if (phase !== 'active') return false;
    if (verb === 'stop' && !completeGateOk) {
      const missing = [
        ...(!visitOk ? ['a visit with labour or distance'] : []),
        ...(!performedOk ? ['the work performed'] : []),
      ];
      Alert.alert('Fill the job card first', `Before completing, enter ${missing.join(' and ')}.`);
      return true;
    }
    if (verb === 'pause' && !performedOk) {
      Alert.alert(
        'Note the work so far',
        'Write a short work performed note before pausing, so the office knows where the job stands.',
      );
      return true;
    }
    return false;
  };

  const onVerb = (verb: 'on_the_way' | 'start' | 'pause' | 'stop' | 'stand_down') => {
    if (verb === 'pause') {
      if (gateRefusal('pause')) return;
      setPausing(true);
    } else if (verb === 'stand_down') confirmStandDown();
    else if (verb === 'stop') {
      if (gateRefusal('stop')) return;
      // Sign-off IS completion (#165): with the card filled, Complete
      // opens the sign-off, and the client's signature finishes the job
      // server-side. A card already sealed (legacy or offline replay)
      // stops directly.
      if (!signed) {
        router.push({ pathname: '/signoff/[id]', params: { id: wo.id } });
        return;
      }
      void apply('stop');
    } else if (verb === 'start' && state === 'on_the_way') {
      // Starting lands the technician where the information gets
      // captured, which is now THIS page's inline job card (#159).
      void apply('start');
    } else void apply(verb);
  };

  const openDispenser = (d: DispenserResolved) => {
    const needsIdentity = !d.make || !d.model || !d.serialNumber;
    router.push({
      pathname: needsIdentity ? '/dispenser/[id]/identity' : '/dispenser/[id]/register',
      params: { id: d.id, siteId: wo.siteId ?? d.siteId, workOrderId: wo.id },
    });
  };

  const allocatedDispenser =
    (wo.assetCode && dispensers?.find((d) => d.id === wo.assetCode)) || null;

  const sitePoint = parseWktPoint(wo.gpsLocation);
  const distanceKm = here && sitePoint ? roadKm(here, { latitude: sitePoint.lat, longitude: sitePoint.lon }) : null;
  const { main: workMain, note: workNote } = splitWorkRequired(wo.workRequired);
  const late = overdueDays(wo.completeBy);


  const openMaps = () => {
    const query = sitePoint ? `${sitePoint.lat},${sitePoint.lon}` : encodeURIComponent(wo.siteName ?? '');
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`).catch(() => {});
  };

  const heroCells: { icon: React.ReactNode; label: string; value: string }[] = [];
  if (phase !== 'done') {
    const est = formatDuration(wo.estimatedDurationMinutes);
    if (est) heroCells.push({ icon: ClockIcon, label: 'Estimated', value: est });
    const day = formatDay(wo.completeBy);
    if (day) heroCells.push({ icon: CalendarIcon, label: 'Complete by', value: day });
    if (phase === 'pre' && distanceKm != null) {
      heroCells.push({ icon: RoadIcon, label: 'Distance to site', value: formatKm(distanceKm) });
    }
  } else {
    if (jcTotals.hours > 0)
      heroCells.push({ icon: TimerIcon, label: 'Time recorded', value: formatDuration(Math.round(jcTotals.hours * 60))! });
    else if (elapsed) heroCells.push({ icon: TimerIcon, label: 'Time on job', value: elapsed });
    const when = wo.lifecycle?.signedOffAt ?? wo.lifecycle?.stoppedAt;
    if (when)
      heroCells.push({
        icon: ClockIcon,
        label: state === 'signed_off' ? 'Signed off' : 'Stopped',
        value: when.slice(11, 16),
      });
  }

  const inputStyle = {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.ink,
    backgroundColor: '#fff',
    fontSize: 14,
  } as const;

  return (
    <FormScrollView>
      <View style={{ marginHorizontal: 12, marginTop: 12 }}>
        <LifecycleActions
          state={state}
          blocksResume={wo.lifecycle?.blocksResume ?? false}
          busy={busy}
          gateNote={gateNote}
          onAction={onVerb}
        />
      </View>

      {/* The hero: the Home card, grown up (#159). */}
      <View
        style={{
          backgroundColor: '#fff',
          borderRadius: 20,
          borderWidth: 1,
          borderColor: colors.line,
          padding: 14,
          marginHorizontal: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <OilDisc customerName={wo.customerName} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.heading, fontSize: 17, color: colors.ink }} numberOfLines={2}>
              {wo.siteName ?? wo.externalRef ?? 'Work order'}
            </Text>
            <Text style={{ fontSize: 12.5, color: colors.muted, marginTop: 1 }} numberOfLines={1}>
              {[wo.customerName, wo.assetDescription ?? wo.assetCode].filter(Boolean).join(' · ') ||
                'Oil company not on record'}
            </Text>
            {wo.isDemo ? (
              <View style={{ flexDirection: 'row', marginTop: 4 }}>
                <Badge text="Demo data" tone="warn" />
              </View>
            ) : null}
          </View>
          <HeroStatus wo={wo} />
        </View>

        {phase === 'done' && (bundle?.jobCard?.workPerformed ?? '').trim() ? (
          <View style={{ marginTop: 9 }}>
            <Text style={{ fontSize: 10.5, letterSpacing: 0.6, color: colors.muted, textTransform: 'uppercase', fontFamily: fonts.bodyMedium }}>
              Work performed
            </Text>
            <Text style={{ fontSize: 13, lineHeight: 19, color: colors.ink, marginTop: 2 }}>
              {bundle!.jobCard!.workPerformed}
            </Text>
          </View>
        ) : workMain ? (
          <View style={{ marginTop: 9 }}>
            <Text style={{ fontSize: 10.5, letterSpacing: 0.6, color: colors.muted, textTransform: 'uppercase', fontFamily: fonts.bodyMedium }}>
              Work required
            </Text>
            <Text style={{ fontSize: 13, lineHeight: 19, color: colors.ink, marginTop: 2 }}>{workMain}</Text>
          </View>
        ) : null}
        {phase !== 'done' && workNote ? (
          <View style={{ marginTop: 9, backgroundColor: colors.bg, borderRadius: 12, padding: 9 }}>
            <Text style={{ fontSize: 11.5, color: colors.muted, lineHeight: 16 }}>{workNote}</Text>
          </View>
        ) : null}

        {heroCells.length > 0 ? (
          <>
            <View style={{ height: 1, backgroundColor: colors.line, marginTop: 11, marginBottom: 10 }} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 9, justifyContent: 'space-between' }}>
              {heroCells.map((c) => (
                <MetaCell key={c.label} icon={c.icon} label={c.label} value={c.value} />
              ))}
            </View>
          </>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
          <Text style={{ fontFamily: fonts.mono, fontSize: 11.5, color: colors.muted }}>
            {[wo.externalRef, wo.statusDescription].filter(Boolean).join(' · ')}
          </Text>
          {phase !== 'done' && late != null ? (
            <View style={{ backgroundColor: colors.redTint, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 }}>
              <Text style={{ color: colors.red, fontSize: 12, fontFamily: fonts.bodyMedium }}>
                Overdue by {late} day{late === 1 ? '' : 's'}
              </Text>
            </View>
          ) : null}
        </View>

        {phase === 'pre' && (sitePoint || here) ? (
          <View style={{ marginTop: 11, borderRadius: 16, overflow: 'hidden' }}>
            <HomeMap here={here} pins={pinsFor([wo])} height={130} />
            <Pressable
              onPress={openMaps}
              accessibilityRole="button"
              accessibilityLabel="Navigate to the site in Google Maps"
              style={{
                position: 'absolute',
                right: 8,
                bottom: 8,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: '#fff',
                borderRadius: 999,
                paddingVertical: 6,
                paddingHorizontal: 12,
                borderWidth: 1,
                borderColor: colors.line,
              }}
            >
              <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                <Path d="M21 3L10.5 13.5M21 3l-7 18-3.5-7.5L3 10z" stroke={colors.navy} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
              <Text style={{ fontSize: 12, color: colors.navy, fontFamily: fonts.bodyMedium }}>Navigate</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {divergence ? (
        <SectionCard title={DIVERGENCE_TITLE[divergence.kind] ?? 'Changed by the office'}>
          <Text style={{ color: colors.ink, fontSize: 14 }}>
            {DIVERGENCE_BODY[divergence.kind] ?? divergence.detail}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>
            OnKey now shows {divergence.onkeyStatus ?? 'no status'}. Noticed{' '}
            {divergence.detectedAt.slice(0, 16).replace('T', ' ')}.
          </Text>
          <Button
            title="I have seen this"
            kind="secondary"
            onPress={() => {
              void acknowledgeDivergence(accessToken, wo.id)
                .then(() => setDivergence(null))
                .catch(() => setDivergence(null));
            }}
          />
        </SectionCard>
      ) : null}

      {rejected.length > 0 ? (
        <SectionCard title="Not accepted by the office">
          <Text style={{ color: colors.ink, fontSize: 13 }}>
            {rejected.length === 1 ? 'An action was' : 'Actions were'} recorded on this device but
            refused when it reached the server. The office does not have{' '}
            {rejected.length === 1 ? 'it' : 'them'}.
          </Text>
          {rejected.map((r, i) => (
            <Text key={i} style={{ color: colors.red, fontSize: 12, marginTop: 4 }}>
              {r.event.replaceAll('_', ' ')}: {r.error}
            </Text>
          ))}
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>
            Call the office before carrying on. This usually means the job was reassigned or
            closed while you were offline.
          </Text>
        </SectionCard>
      ) : null}

      {state === 'paused' && wo.lifecycle?.pauseReason ? (
        <SectionCard title="Paused">
          <Text style={{ color: colors.ink, fontSize: 13 }}>
            {reasons.find((r) => r.code === wo.lifecycle?.pauseReason)?.label ?? wo.lifecycle.pauseReason}
          </Text>
          {wo.lifecycle.pauseNote ? (
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{wo.lifecycle.pauseNote}</Text>
          ) : null}
          {wo.lifecycle.blocksResume ? (
            <Text style={{ color: colors.amber, fontSize: 12, marginTop: 6 }}>
              Handed back: the office actions this work order from here. You cannot resume it.
            </Text>
          ) : null}
        </SectionCard>
      ) : null}

      {/* STARTED: the whole job card on the page (#159, #162, owner rule).
          Spares booking and the client sign-off open their own pages; the
          record of both stays here. */}
      {phase === 'active' ? (
        <>
          {(() => {
            // OnKey's placeholder row, on every work order and saying
            // nothing; the print template filters it the same way.
            const realTasks = (bundle?.tasks ?? []).filter(
              (t) => (t.description ?? '').trim().toLowerCase() !== 'default task',
            );
            if (realTasks.length === 0) return null;
            return (
              <SectionCard title="Work tasks">
                {realTasks.map((t, i) => (
                  <View
                    key={i}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                      gap: 8,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: colors.line,
                      paddingVertical: 8,
                    }}
                  >
                    <Badge text={t.done ? 'Done' : 'Open'} tone={t.done ? 'ok' : 'muted'} />
                    <Text style={{ flex: 1, color: colors.ink, fontSize: 13 }}>{t.description}</Text>
                  </View>
                ))}
              </SectionCard>
            );
          })()}
          <SectionCard title="Job card">
            {visits.map((v, vi) => (
              <View
                key={`${visits.length}-${vi}`}
                style={{
                  borderTopWidth: vi === 0 ? 0 : 1,
                  borderTopColor: colors.line,
                  paddingTop: vi === 0 ? 0 : 10,
                  marginBottom: vi === visits.length - 1 ? 0 : 10,
                }}
              >
                {visits.length > 1 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                    <Text style={{ flex: 1, color: colors.ink, fontSize: 13, fontFamily: fonts.bodyMedium }}>
                      Visit {vi + 1}
                      {v.date ? `  ${v.date}` : ''}
                    </Text>
                    {!signed ? (
                      <Text
                        onPress={() => {
                          dirty.current = true;
                          const next = visits.filter((_, j) => j !== vi);
                          setVisits(next);
                          persist({ visits: next });
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove visit ${vi + 1}`}
                        style={{ color: colors.red, fontSize: 13, paddingHorizontal: 6 }}
                      >
                        &#10007;
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {(
                    [
                      { key: 'distanceKm', label: 'Distance (km)' },
                      { key: 'labourHours', label: 'Labour (h)' },
                      { key: 'labourOt15Hours', label: 'OT 1.5 (h)' },
                      { key: 'labourOt20Hours', label: 'OT 2.0 (h)' },
                    ] as const
                  ).map(({ key, label }) => (
                    <View key={key} style={{ flex: 1 }}>
                      <Text style={{ color: colors.muted, fontSize: 10.5, marginBottom: 3 }}>{label}</Text>
                      <TextInput
                        style={inputStyle}
                        defaultValue={v[key] ? String(v[key]) : ''}
                        onChangeText={(t) => {
                          dirty.current = true;
                          setVisits((prev) => {
                            const next = prev.length ? [...prev] : [blankVisit()];
                            next[vi] = { ...next[vi], [key]: num(t) };
                            return next;
                          });
                        }}
                        onBlur={() => persist()}
                        editable={!signed}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        accessibilityLabel={`${label}, visit ${vi + 1}`}
                      />
                    </View>
                  ))}
                </View>
              </View>
            ))}
            {!signed ? (
              <Text
                onPress={() => {
                  dirty.current = true;
                  const next = [...visits, blankVisit()];
                  setVisits(next);
                  persist({ visits: next });
                }}
                accessibilityRole="button"
                accessibilityLabel="Add a visit"
                style={{ color: colors.blueText, fontSize: 12.5, fontFamily: fonts.bodyMedium, marginTop: 8 }}
              >
                + Add a visit
              </Text>
            ) : null}
            <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 10, marginBottom: 3 }}>
              Work performed (required to complete)
            </Text>
            <TextInput
              style={[inputStyle, { minHeight: 70 }]}
              multiline
              textAlignVertical="top"
              placeholder="Describe what was done"
              value={performed}
              onChangeText={(t) => {
                dirty.current = true;
                setPerformed(t);
              }}
              onBlur={() => persist()}
              editable={!signed}
            />
          </SectionCard>

          <SectionCard title="Spares booked">
            {jcTotals.items.length > 0 ? (
              jcTotals.items.map((p, i) => (
                <View
                  key={`${p.itemCode}-${i}`}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    paddingVertical: 6,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: colors.line,
                  }}
                >
                  <Text style={{ color: colors.ink, fontSize: 13, flex: 1 }} numberOfLines={1}>
                    {p.description || p.itemCode}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12.5, fontVariant: ['tabular-nums'] }}>
                    {p.quantity}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={{ color: colors.muted, fontSize: 12 }}>No spares booked yet.</Text>
            )}
            {!signed ? (
              <Button
                title="Book spares"
                kind="secondary"
                onPress={() => router.push({ pathname: '/spares/[id]', params: { id: wo.id } })}
              />
            ) : null}
          </SectionCard>

          <SectionCard title="Client sign-off">
            {signed ? (
              <>
                <Badge text="Signed" tone="ok" />
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
                  Accepted by {bundle?.jobCard?.clientName}
                  {bundle?.jobCard?.signedAt ? ` at ${bundle.jobCard.signedAt.slice(11, 16)}` : ''}.
                </Text>
                {state === 'paused' ? (
                  <Button
                    title="Job card PDF (incomplete)"
                    kind="secondary"
                    onPress={() =>
                      router.push({ pathname: '/jobcard/[id]', params: { id: String(id), wm: '1' } })
                    }
                  />
                ) : null}
              </>
            ) : state === 'paused' && wo.lifecycle?.blocksResume ? (
              <>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  The office has this job now. The client signs the incomplete job card so the
                  work done so far is acknowledged and booked.
                </Text>
                <Button
                  title="Client sign-off"
                  onPress={() => router.push({ pathname: '/signoff/[id]', params: { id: wo.id } })}
                />
              </>
            ) : (
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                Completing the job opens the sign-off: the client's name, contact details and
                signature finish it.
              </Text>
            )}
          </SectionCard>
        </>
      ) : null}

      {/* DONE: the outcome (#159). */}
      {phase === 'done' ? (
        <>
          <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 12, marginTop: 12 }}>
            {(
              [
                { icon: RoadIcon, v: `${Math.round(jcTotals.km)} km`, l: 'Travelled' },
                { icon: ClockIcon, v: `${jcTotals.hours % 1 ? jcTotals.hours.toFixed(1) : jcTotals.hours} h`, l: 'Labour' },
                { icon: BoxIcon, v: String(jcTotals.spares), l: 'Spares' },
              ] as const
            ).map((s) => (
              <View
                key={s.l}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  backgroundColor: '#fff',
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: colors.line,
                  paddingVertical: 9,
                  paddingHorizontal: 10,
                }}
              >
                <View style={{ width: 26, height: 26, borderRadius: 999, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
                  {s.icon}
                </View>
                <View style={{ minWidth: 0 }}>
                  <Text style={{ fontFamily: fonts.heading, fontSize: 15, color: colors.ink, fontVariant: ['tabular-nums'] }}>
                    {s.v}
                  </Text>
                  <Text style={{ fontSize: 10.5, color: colors.muted }}>{s.l}</Text>
                </View>
              </View>
            ))}
          </View>

          {signed ? (
            <Pressable
              onPress={() =>
                router.push({ pathname: '/jobcard/[id]', params: { id: String(id) } })
              }
              accessibilityRole="button"
              accessibilityLabel="Open the signed job card"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                backgroundColor: '#fff',
                borderRadius: 20,
                borderWidth: 1,
                borderColor: colors.line,
                padding: 14,
                marginHorizontal: 12,
                marginTop: 12,
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 58,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: colors.line,
                  padding: 5,
                  gap: 3,
                }}
              >
                <View style={{ height: 5, width: '60%', backgroundColor: colors.navy, borderRadius: 2 }} />
                {[0, 1, 2, 3].map((i) => (
                  <View key={i} style={{ height: 3, backgroundColor: colors.mist, borderRadius: 2 }} />
                ))}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: fonts.heading, fontSize: 16, color: colors.ink }}>Job card, signed</Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 1 }}>
                  {bundle?.jobCard?.clientName ? `Accepted by ${bundle.jobCard.clientName}` : 'Accepted'}
                  {bundle?.jobCard?.signedAt ? ` at ${bundle.jobCard.signedAt.slice(11, 16)}` : ''} · PDF
                </Text>
              </View>
              <Text style={{ color: colors.green, fontFamily: fonts.bodyMedium, fontSize: 13.5 }}>Open</Text>
            </Pressable>
          ) : (
            <View style={{ marginHorizontal: 12, marginTop: 12 }}>
              <Button
                title="Client sign-off"
                onPress={() => router.push({ pathname: '/signoff/[id]', params: { id: wo.id } })}
              />
            </View>
          )}

          {jcTotals.items.length > 0 ? (
            <SectionCard title="Spares booked">
              {jcTotals.items.map((p, i) => (
                <View
                  key={`${p.itemCode}-${i}`}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    paddingVertical: 7,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: colors.line,
                  }}
                >
                  <Text style={{ color: colors.ink, fontSize: 13, flex: 1 }} numberOfLines={1}>
                    {p.description || p.itemCode}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12.5, fontVariant: ['tabular-nums'] }}>
                    {p.quantity}
                  </Text>
                </View>
              ))}
            </SectionCard>
          ) : null}
        </>
      ) : null}

      {pausing ? (
        <SectionCard title="Why are you pausing?">
          {reasons.map((r) => {
            const on = chosenReason?.code === r.code;
            return (
              <Text
                key={r.code}
                onPress={() => setChosenReason(r)}
                accessibilityRole="button"
                style={{
                  paddingVertical: 9,
                  paddingHorizontal: 10,
                  marginBottom: 5,
                  borderWidth: 1,
                  borderRadius: 10,
                  borderColor: on ? colors.blueText : colors.line,
                  backgroundColor: on ? colors.blueTint : '#fff',
                  color: on ? colors.blueText : colors.ink,
                  fontSize: 14,
                }}
              >
                {r.label}
                {r.blocksResume ? '  (cannot be resumed)' : ''}
              </Text>
            );
          })}
          {chosenReason?.requiresNote ? (
            <TextInput
              style={[inputStyle, { minHeight: 60, marginTop: 4 }]}
              multiline
              textAlignVertical="top"
              placeholder="Describe the reason"
              value={note}
              onChangeText={setNote}
            />
          ) : null}
          <Button title="Confirm pause" onPress={confirmPause} busy={busy} />
          <Button title="Cancel" kind="secondary" onPress={() => setPausing(false)} />
        </SectionCard>
      ) : null}

      {/* What the technician will find on site (#123). Never a forced
          selection (#159): the OnKey-named asset is highlighted, the
          whole site stays in scope. Calibration work only (#167): a leak
          detector PM has no business offering a verification. */}
      {wo.isCalibration ? (
      <SectionCard title="Dispensers on site">
        {!wo.siteId ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            This work order has no site on record yet, so dispensers cannot be listed.
          </Text>
        ) : dispensers === null ? (
          <Text style={{ color: dispensersFailed ? colors.amber : colors.muted, fontSize: 12 }}>
            {dispensersFailed
              ? 'Could not load the dispensers for this site. Pull back and reopen to retry.'
              : 'Loading…'}
          </Text>
        ) : dispensers.length === 0 ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            No dispensers on record for this site yet.
          </Text>
        ) : (
          <>
            {dispensers.map((d) => {
              const allocated = !!wo.assetCode && d.id === wo.assetCode;
              return (
                <Pressable
                  key={d.id}
                  onPress={() => openDispenser(d)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open dispenser ${d.id}`}
                  style={{
                    borderWidth: 1,
                    borderColor: allocated ? colors.green : colors.line,
                    backgroundColor: allocated ? colors.greenTint : '#fff',
                    borderRadius: 12,
                    padding: 10,
                    marginTop: 8,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ flex: 1, color: colors.ink, fontSize: 14, fontFamily: fonts.bodyMedium }}>
                      {[d.make, d.model].filter(Boolean).join(' ') || 'Identity not captured'}
                    </Text>
                    {allocated ? <Badge text="Named on this job" tone="ok" /> : null}
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                    {d.id}
                    {d.serialNumber ? ` · ${d.serialNumber}` : ''}
                    {' · '}
                    {d.hoseCount == null ? 'hoses not recorded' : `${d.hoseCount} hoses`}
                  </Text>
                </Pressable>
              );
            })}
            {wo.assetCode && !dispensers.some((d) => d.id === wo.assetCode) ? (
              <Text style={{ color: colors.amber, fontSize: 12, marginTop: 8 }}>
                This job is against {wo.assetCode}, which is not on our register for this site.
              </Text>
            ) : null}
          </>
        )}
      </SectionCard>
      ) : null}

      {/* The verification launcher stays inside the job. */}
      {wo.isCalibration && (state === 'started' || state === 'paused' || state === 'stopped') ? (
        <SectionCard title="Verification">
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 6 }}>
            Issue an NRCS verification certificate for a dispenser on this site. Standard and
            high flow are selected from the dispenser's data plate.
          </Text>
          {allocatedDispenser ? (
            <>
              <Button
                title={`Start verification on ${
                  [allocatedDispenser.make, allocatedDispenser.model].filter(Boolean).join(' ') ||
                  allocatedDispenser.id
                }`}
                onPress={() => openDispenser(allocatedDispenser)}
              />
              <Button
                title="Choose a different dispenser"
                kind="secondary"
                onPress={() =>
                  router.push({
                    pathname: '/site/[id]',
                    params: { id: wo.siteId!, workOrderId: wo.id },
                  })
                }
              />
            </>
          ) : wo.siteId ? (
            <Button
              title="Start a verification"
              onPress={() =>
                router.push({
                  pathname: '/site/[id]',
                  params: { id: wo.siteId!, workOrderId: wo.id },
                })
              }
            />
          ) : (
            <Text style={{ color: colors.amber, fontSize: 12 }}>
              This work order has no site on record yet, so dispensers cannot be listed.
            </Text>
          )}
        </SectionCard>
      ) : null}

      {/* Past work at this site (#159): on the way in, and on the way out. */}
      {(phase === 'pre' || phase === 'done' || state === 'paused') && past.length > 0 ? (
        <SectionCard title="Past work at this site">
          {past.map((p, i) => (
            <Pressable
              key={`${p.ref}-${i}`}
              disabled={!p.ref}
              onPress={() =>
                router.push({
                  pathname: '/pastwork/[ref]',
                  params: { ref: String(p.ref), when: p.when ?? '', what: p.what },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`Open past work order ${p.ref ?? ''}`}
              style={{ paddingVertical: 8, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text style={{ fontFamily: fonts.mono, fontSize: 11.5, color: colors.ink }}>{p.ref ?? ''}</Text>
                <Text style={{ fontSize: 11.5, color: colors.muted }}>{p.when ?? ''}</Text>
              </View>
              <Text style={{ fontSize: 12.5, color: colors.muted, marginTop: 2 }} numberOfLines={2}>
                {p.what}
              </Text>
              {p.ref ? (
                <Text style={{ fontSize: 11.5, color: colors.blueText, marginTop: 3, fontFamily: fonts.bodyMedium }}>
                  View detail
                </Text>
              ) : null}
            </Pressable>
          ))}
        </SectionCard>
      ) : null}
    </FormScrollView>
  );
}

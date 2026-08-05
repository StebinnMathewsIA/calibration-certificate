/**
 * Work order detail and lifecycle (#95): Tap to Start begins the SLA,
 * Pause needs a reason (incomplete-for-spares and referral cannot be
 * resumed by the technician), Stop ends the SLA and unlocks sign-off.
 * The state machine is enforced server-side; this screen presents it.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Alert, Text, TextInput, View } from 'react-native';
import {
  PauseReason,
  WorkOrderRecord,
  listPauseReasons,
  listWorkOrderRecords,
  transitionWorkOrder,
} from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { Badge, Button, SectionCard, colors, fonts } from '../../src/components/ui';
import { FormScrollView } from '../../src/components/FormScrollView';
import { MiniMap } from '../../src/components/MiniMap';
import { fetchThrough, readCache, writeCache } from '../../src/db/cache';
import { rejectedTransitions } from '../../src/sync/outbox';

/** Same cache key My day reads. The two MUST agree: this screen used to
 * fetch the list itself, so a failed request left it on "Loading..."
 * forever under a list that had rendered from cache. */
const WO_CACHE_KEY = 'wo:records';

const STATE_LABEL: Record<string, string> = {
  not_started: 'Not started',
  on_the_way: 'On the way',
  started: 'In progress',
  paused: 'Paused',
  stopped: 'Stopped, ready to sign off',
  signed_off: 'Signed off',
};

const STATE_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'muted'> = {
  not_started: 'muted',
  on_the_way: 'ok',
  started: 'ok',
  paused: 'warn',
  stopped: 'ok',
  signed_off: 'ok',
};

/** Elapsed working time: wall clock since start, minus completed pauses. */
function elapsedLabel(wo: WorkOrderRecord): string | null {
  const l = wo.lifecycle;
  if (!l?.startedAt) return null;
  const end = l.stoppedAt ? new Date(l.stoppedAt) : new Date();
  const gross = (end.getTime() - new Date(l.startedAt).getTime()) / 1000;
  const net = Math.max(0, gross - (l.pausedSeconds ?? 0));
  const h = Math.floor(net / 3600);
  const m = Math.round((net % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
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
  // "No record yet" and "the request failed" and "it is not in your list"
  // are three different things. Collapsing them into a null work order is
  // what put a technician on a blank Loading screen with no way forward.
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  // A lifecycle action the server has refused on replay. The technician
  // acted, the screen showed it applied, and it did not stick. Saying
  // nothing would leave them believing the office knows.
  const [rejected, setRejected] = useState<{ event: string; error: string }[]>([]);

  const load = useCallback(() => {
    setLoadState((s) => (s === 'ready' ? s : 'loading'));
    fetchThrough<WorkOrderRecord[]>(WO_CACHE_KEY, () => listWorkOrderRecords(accessToken))
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

  const state = wo?.lifecycle?.state ?? 'not_started';
  const elapsed = useMemo(() => (wo ? elapsedLabel(wo) : null), [wo]);

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
          <Text
            style={{ color: colors.muted, fontSize: 12, marginTop: 6, fontFamily: fonts.mono }}
          >
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
  ) => {
    setBusy(true);
    try {
      // Location is best-effort context on the transition, never a gate.
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
      // Write the new state straight into the list My day reads, so its
      // badge changes the moment you go back rather than on the next
      // background refresh.
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
    } catch (err) {
      Alert.alert(
        'Could not update the work order',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(false);
    }
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
        `Pausing for "${chosenReason.label}" hands the work order back: you will not be able to resume it yourself.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Pause anyway',
            style: 'destructive',
            onPress: () => void apply('pause', { reason: chosenReason.code, note: note.trim() }),
          },
        ],
      );
      return;
    }
    void apply('pause', { reason: chosenReason.code, note: note.trim() });
  };

  return (
    <FormScrollView>
      <SectionCard title={wo.siteName ?? wo.externalRef ?? 'Work order'}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Badge text={STATE_LABEL[state] ?? state} tone={STATE_TONE[state] ?? 'muted'} />
          {wo.isDemo ? <Badge text="Demo data" tone="warn" /> : null}
        </View>
        <Text style={{ color: colors.ink, fontSize: 14 }}>{wo.workRequired}</Text>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
          {[wo.customerName, wo.externalRef, wo.assetDescription ?? wo.assetCode]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
          {wo.completeBy ? `Complete by ${wo.completeBy.slice(0, 16).replace('T', ' ')}` : ''}
          {wo.estimatedDurationMinutes ? ` · about ${wo.estimatedDurationMinutes} min` : ''}
        </Text>
        {elapsed ? (
          <Text
            style={{
              marginTop: 6,
              color: colors.ink,
              fontFamily: fonts.mono,
              fontVariant: ['tabular-nums'],
            }}
          >
            Working time: {elapsed}
            {wo.lifecycle?.pausedSeconds
              ? ` (paused ${Math.round(wo.lifecycle.pausedSeconds / 60)} min)`
              : ''}
          </Text>
        ) : null}
        <MiniMap gpsWkt={wo.gpsLocation} address={wo.siteName ?? undefined} />
      </SectionCard>

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
            {reasons.find((r) => r.code === wo.lifecycle?.pauseReason)?.label ??
              wo.lifecycle.pauseReason}
          </Text>
          {wo.lifecycle.pauseNote ? (
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
              {wo.lifecycle.pauseNote}
            </Text>
          ) : null}
          {wo.lifecycle.blocksResume ? (
            <Text style={{ color: colors.amber, fontSize: 12, marginTop: 6 }}>
              ⚠ Handed back: the office actions this work order from here. You cannot resume it.
            </Text>
          ) : null}
        </SectionCard>
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
              style={{
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: 10,
                padding: 10,
                marginTop: 4,
                minHeight: 60,
                color: colors.ink,
                backgroundColor: '#fff',
              }}
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

      <View style={{ marginHorizontal: 12 }}>
        {state === 'not_started' ? (
          <>
            <Button title="On the way" onPress={() => void apply('on_the_way')} busy={busy} />
            {/* Still offered: a technician already at the site should not
                have to claim a journey they did not make. */}
            <Button
              title="Already here, start work"
              kind="secondary"
              onPress={() => void apply('start')}
              busy={busy}
            />
          </>
        ) : null}
        {state === 'on_the_way' && !pausing ? (
          <>
            <Button title="Arrived, start work" onPress={() => void apply('start')} busy={busy} />
            <Button title="Cannot get there" kind="secondary" onPress={() => setPausing(true)} />
          </>
        ) : null}
        {state === 'started' && !pausing ? (
          <>
            <Button title="Pause" kind="secondary" onPress={() => setPausing(true)} />
            <Button title="Stop (work complete)" onPress={() => void apply('stop')} busy={busy} />
          </>
        ) : null}
        {state === 'paused' && !wo.lifecycle?.blocksResume ? (
          <Button title="Resume" onPress={() => void apply('start')} busy={busy} />
        ) : null}
        {state === 'stopped' ? (
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>
            Work is stopped. Job card sign-off arrives with the next release.
          </Text>
        ) : null}
      </View>

      {/* The verification launcher now lives INSIDE the job (platform
          vision): start a certificate without leaving the work order. */}
      {state === 'started' || state === 'paused' || state === 'stopped' ? (
        <SectionCard title="Verification">
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 6 }}>
            Issue an NRCS verification certificate for a dispenser on this site. Standard and
            high flow are selected from the dispenser's data plate.
          </Text>
          {wo.siteId ? (
            <Button
              title="Start a verification"
              onPress={() => router.push({ pathname: '/site/[id]', params: { id: wo.siteId! } })}
            />
          ) : (
            <Text style={{ color: colors.amber, fontSize: 12 }}>
              This work order has no site on record yet, so dispensers cannot be listed.
            </Text>
          )}
        </SectionCard>
      ) : null}

      <View style={{ marginHorizontal: 12 }}>
      </View>
    </FormScrollView>
  );
}

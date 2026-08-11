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
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import {
  DispenserResolved,
  PauseReason,
  WoDivergence,
  WorkOrderRecord,
  acknowledgeDivergence,
  listDivergence,
  listPauseReasons,
  listSiteDispensers,
  listWorkOrderRecords,
  standDownWorkOrder,
  transitionWorkOrder,
} from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { Badge, Button, SectionCard, colors, fonts } from '../../src/components/ui';
import { FormScrollView } from '../../src/components/FormScrollView';
import { LifecycleActions } from '../../src/components/LifecycleActions';
import { MiniMap } from '../../src/components/MiniMap';
import { fetchThrough, readCache, writeCache } from '../../src/db/cache';
import { rejectedTransitions } from '../../src/sync/outbox';

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
  // The office moved this job while the technician holds it. Detected on
  // sync (migration 047), where the register is actually fresh.
  const [divergence, setDivergence] = useState<WoDivergence | null>(null);
  const [dispensers, setDispensers] = useState<DispenserResolved[] | null>(null);
  const [dispensersFailed, setDispensersFailed] = useState(false);

  // The fetch the card was always waiting for (#143). setDispensers was
  // declared and never called, so the card said "Loading" for ever. Keyed
  // on the site rather than folded into load(), because the site id is
  // only known once the work order has arrived. Same cache key as the
  // site screen, so the two share one offline copy.
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
        // "Could not load" and "loading" are different situations, and a
        // card that shows the second while meaning the first is how this
        // bug stayed invisible.
        if (alive) setDispensersFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [accessToken, siteId]);

  const load = useCallback(() => {
    setLoadState((s) => (s === 'ready' ? s : 'loading'));
    fetchThrough<WorkOrderRecord[]>(WO_CACHE_KEY, () => listWorkOrderRecords(accessToken), {
      // Without onFresh the revalidated record only reached the cache, so a
      // status the office changed (or a sign-off applied through the job
      // card) showed up one visit late.
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

  // Returns whether the transition applied, because Start work opens the
  // job card afterwards (#144) and opening it on a refused transition
  // would put the technician in a job card for work the server does not
  // believe has started.
  const apply = async (
    event: 'on_the_way' | 'start' | 'pause' | 'stop' | 'sign_off',
    opts: { reason?: string; note?: string } = {},
  ): Promise<boolean> => {
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
      return true;
    } catch (err) {
      Alert.alert(
        'Could not update the work order',
        err instanceof Error ? err.message : String(err),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** Abandoning a journey is not pausing work. It used to open "Why are
   * you pausing?" and offer six reasons about work in progress, two of
   * which permanently block resuming, for a job the technician never
   * reached (#127). A plain confirmation is the whole of it. */
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
                Alert.alert(
                  'Could not stand down',
                  err instanceof Error ? err.message : String(err),
                ),
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
      {/* The verbs first, above the description and the map. They were
          three stacked full-width buttons further down the page, so the
          technician scrolled past the job to reach the thing they came to
          tap (#122). */}
      <View style={{ marginHorizontal: 12, marginTop: 12 }}>
        <LifecycleActions
          state={state}
          blocksResume={wo.lifecycle?.blocksResume ?? false}
          busy={busy}
          onAction={(verb) => {
            // Pause needs a reason before it can be applied, so it opens
            // the sheet. Cannot-get-there is its own verb now (#144): it
            // used to ride on the disabled On-the-way button, which made
            // the #127 stand-down unreachable in exactly the state it
            // existed for.
            if (verb === 'pause') setPausing(true);
            else if (verb === 'stand_down') confirmStandDown();
            else if (verb === 'start' && state === 'on_the_way') {
              // Starting the job opens the job card, so the technician
              // lands where the information gets captured (#144). Resume
              // from a pause deliberately does not: they were already
              // somewhere.
              void apply('start').then((applied) => {
                if (applied) {
                  router.push({ pathname: '/jobcard/[id]', params: { id: wo.id } });
                }
              });
            } else void apply(verb);
          }}
        />
      </View>

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
        {/* Deliberately quiet, and deliberately called "on this job" rather
            than "working time" (#121). It is how long the app has been in
            this state, which is useful for orientation and is NOT what gets
            billed: labour is entered per visit on the job card. Presenting
            it as a measurement of work is what printed one minute next to
            four point two charged hours. */}
        {elapsed ? (
          <Text style={{ marginTop: 6, color: colors.muted, fontSize: 12 }}>
            On this job {elapsed}
            {wo.lifecycle?.pausedSeconds
              ? `, paused ${Math.round(wo.lifecycle.pausedSeconds / 60)} min`
              : ''}
          </Text>
        ) : null}
        <MiniMap gpsWkt={wo.gpsLocation} address={wo.siteName ?? undefined} />
      </SectionCard>

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
        {/* Job card is a DESTINATION, not a lifecycle verb, so it stays a
            labelled button. The verbs are the icon row at the top. */}
        {state === 'stopped' ? (
          <Button
            title="Job card and sign-off"
            onPress={() => router.push({ pathname: '/jobcard/[id]', params: { id: wo.id } })}
          />
        ) : null}
        {state === 'signed_off' ? (
          <Button
            title="View job card"
            kind="secondary"
            onPress={() => router.push({ pathname: '/jobcard/[id]', params: { id: wo.id } })}
          />
        ) : null}
        {/* Reachable before stopping too: technicians fill the card in as
            they go, and only the SIGNING needs the work stopped. */}
        {state === 'started' || state === 'paused' ? (
          <Button
            title="Job card"
            kind="secondary"
            onPress={() => router.push({ pathname: '/jobcard/[id]', params: { id: wo.id } })}
          />
        ) : null}
      </View>

      {/* What the technician will find on site, before they drive out
          (#123): whose dispenser, which model, how many hoses, therefore
          which parts to load. All of it was already held, and reachable
          only after arriving and picking a dispenser. */}
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
                  onPress={() =>
                    router.push({
                      pathname:
                        !d.make || !d.model || !d.serialNumber
                          ? '/dispenser/[id]/identity'
                          : '/dispenser/[id]/register',
                      params: { id: d.id },
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Open dispenser ${d.id}`}
                  style={{
                    borderWidth: 1,
                    borderColor: allocated ? colors.green : colors.line,
                    backgroundColor: allocated ? colors.greenTint : '#fff',
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 8,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text
                      style={{ flex: 1, color: colors.ink, fontSize: 14, fontFamily: fonts.bodyMedium }}
                    >
                      {[d.make, d.model].filter(Boolean).join(' ') || 'Identity not captured'}
                    </Text>
                    {allocated ? <Badge text="This job" tone="ok" /> : null}
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
              /* A gap in the register worth seeing, not an error to hide. */
              <Text style={{ color: colors.amber, fontSize: 12, marginTop: 8 }}>
                This job is against {wo.assetCode}, which is not on our register for this site.
              </Text>
            ) : null}
          </>
        )}
      </SectionCard>

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

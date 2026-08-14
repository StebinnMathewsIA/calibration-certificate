/**
 * The freshness gate (#150): online means current before the screen
 * settles. On launch, and on returning to the foreground after a real
 * gap, the app force-refreshes the caches a technician acts on (work
 * list, stock scope, team vans) behind a branded loading state, so the
 * first thing they see is the present, not a memory.
 *
 * Three rules keep it honest:
 * - Offline is a fact, not a fault: no gate, cached world immediately,
 *   the existing offline banner already says so.
 * - The wait is capped at ten seconds. A slow link yields to the cached
 *   copy with a visible "still checking" chip rather than locking the
 *   technician out of their own day.
 * - It runs on launch and on foregrounding after ten minutes away, never
 *   on tab switches: the tabs already refresh themselves on focus.
 */
import NetInfo from '@react-native-community/netinfo';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { refreshCoreCaches } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { notifyFreshnessSettled } from '../sync/freshness';
import { colors, fonts } from './ui';

/** Foreground gap that counts as "been away": below this the technician
 * just flicked to another app and back, and the tabs' own focus refresh
 * covers it. */
const FOREGROUND_GAP_MS = 10 * 60 * 1000;

/** The cap. Past this the gate yields to cached data. */
const GATE_CAP_MS = 10 * 1000;

export function FreshnessGate() {
  const { accessToken } = useAuth();
  // idle: nothing showing. gating: full overlay, refresh in flight.
  // overrun: yielded at the cap, refresh still in flight, chip showing.
  const [phase, setPhase] = useState<'idle' | 'gating' | 'overrun'>('idle');
  const running = useRef(false);
  const backgroundedAt = useRef<number | null>(null);
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;

  const run = useCallback(async () => {
    const token = tokenRef.current;
    if (running.current || !token) return;
    running.current = true;
    try {
      const net = await NetInfo.fetch();
      if (!net.isConnected || net.isInternetReachable === false) return;
      setPhase('gating');
      const refresh = refreshCoreCaches(token);
      let timer: ReturnType<typeof setTimeout>;
      const cap = new Promise<'cap'>((resolve) => {
        timer = setTimeout(() => resolve('cap'), GATE_CAP_MS);
      });
      const winner = await Promise.race([refresh.then(() => 'done' as const), cap]);
      clearTimeout(timer!);
      if (winner === 'cap') {
        setPhase('overrun');
        // The chip stays until the refresh actually settles, then goes
        // quietly. refreshCoreCaches never rejects (allSettled inside),
        // but a belt under braces costs one line.
        refresh
          .catch(() => {})
          .finally(() => {
            setPhase('idle');
            notifyFreshnessSettled();
          });
      } else {
        setPhase('idle');
        notifyFreshnessSettled();
      }
    } catch {
      setPhase('idle');
    } finally {
      running.current = false;
    }
  }, []);

  // Launch, and again after a sign-in: the caches are scoped to the
  // person. Guarded to once per signed-in session, because the access
  // token itself ROTATES every hour (#84) and each rotation lands here;
  // keying the gate on the token raw would flash the overlay over a
  // technician mid-job every hour.
  const gated = useRef(false);
  useEffect(() => {
    if (!accessToken) {
      gated.current = false;
      return;
    }
    if (!gated.current) {
      gated.current = true;
      void run();
    }
  }, [accessToken, run]);

  // Foreground after a real gap. The listener records when the app left
  // the foreground and compares on return.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        if (backgroundedAt.current === null) backgroundedAt.current = Date.now();
      } else if (state === 'active') {
        const away = backgroundedAt.current;
        backgroundedAt.current = null;
        if (away !== null && Date.now() - away >= FOREGROUND_GAP_MS) void run();
      }
    });
    return () => sub.remove();
  }, [run]);

  if (phase === 'gating') {
    return (
      <View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: colors.navy,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}
        accessibilityLabel="Checking for changes"
      >
        <Text style={{ color: '#fff', fontFamily: fonts.heading, fontSize: 26 }}>
          prowalco
        </Text>
        <ActivityIndicator color="#fff" style={{ marginTop: 18 }} />
        <Text style={{ color: '#fff', opacity: 0.75, fontSize: 13, marginTop: 12 }}>
          Checking for changes
        </Text>
      </View>
    );
  }

  if (phase === 'overrun') {
    return (
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          bottom: 96,
          left: 0,
          right: 0,
          alignItems: 'center',
          zIndex: 1000,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: colors.amberTint,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: 999,
            paddingHorizontal: 14,
            paddingVertical: 8,
          }}
        >
          <ActivityIndicator size="small" color={colors.ink} />
          <Text style={{ color: colors.ink, fontSize: 13 }}>
            Slow connection: showing your last synced copy while it updates
          </Text>
        </View>
      </View>
    );
  }

  return null;
}

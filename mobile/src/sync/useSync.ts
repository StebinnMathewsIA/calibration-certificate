/**
 * Sync triggers (Arch v2 phase 2, #66) — same pattern as useSignQueue:
 * launch, app foreground, connectivity regained, and a 15-minute interval.
 * Mount once at the root layout. Work orders arrive "in the morning and
 * during the day", so every signal window refreshes the mirror.
 */
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { syncAll } from './syncEngine';

export function useSync(): void {
  const { accessToken } = useAuth();
  const running = useRef(false);

  useEffect(() => {
    const run = async () => {
      if (running.current || !accessToken) return;
      running.current = true;
      try {
        await syncAll(accessToken);
      } catch {
        // Offline or transient — the next trigger retries.
      } finally {
        running.current = false;
      }
    };

    run(); // launch / sign-in

    const netSub = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) run();
    });
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    const interval = setInterval(run, 15 * 60_000);

    return () => {
      netSub();
      appSub.remove();
      clearInterval(interval);
    };
  }, [accessToken]);
}

import NetInfo from '@react-native-community/netinfo';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { processQueue } from './signQueue';

/**
 * Drains the sign queue on launch, on app foreground, on reconnect, and on a
 * slow safety interval. Mount once at the root layout.
 */
export function useSignQueue(): void {
  const { accessToken } = useAuth();
  const running = useRef(false);

  useEffect(() => {
    const drain = async () => {
      if (running.current) return;
      running.current = true;
      try {
        await processQueue(accessToken);
      } finally {
        running.current = false;
      }
    };

    drain(); // launch

    const netSub = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) drain();
    });
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') drain();
    });
    const interval = setInterval(drain, 60_000);

    return () => {
      netSub();
      appSub.remove();
      clearInterval(interval);
    };
  }, [accessToken]);
}

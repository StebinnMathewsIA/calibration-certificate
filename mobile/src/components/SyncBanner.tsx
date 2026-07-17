import NetInfo from '@react-native-community/netinfo';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import * as repo from '../db/certificateRepo';
import { backfillCertificateNumbers, processQueue } from '../queue/signQueue';
import { colors } from './ui';

/**
 * Persistent queue-visibility banner (iAuditor/Fieldwire pattern): the VO can
 * always see whether anything is waiting to sign and force a drain. Renders
 * nothing when online with an empty queue.
 */
export function SyncBanner({ onQueueDrained }: { onQueueDrained?: () => void }) {
  const { accessToken } = useAuth();
  const [online, setOnline] = useState(true);
  const [counts, setCounts] = useState({ queued: 0, uploading: 0, awaitingSync: 0 });
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(() => {
    setCounts({
      queued: repo.listInState('QUEUED_FOR_SIGNING').length,
      uploading: repo.listInState('UPLOADING').length,
      awaitingSync: repo.listInState('SIGNED').length,
    });
  }, []);

  useEffect(() => {
    refresh();
    const net = NetInfo.addEventListener((s) =>
      setOnline(Boolean(s.isConnected) && s.isInternetReachable !== false),
    );
    const interval = setInterval(refresh, 3000);
    return () => {
      net();
      clearInterval(interval);
    };
  }, [refresh]);

  const inFlight = counts.queued + counts.uploading;
  if (online && inFlight === 0 && counts.awaitingSync === 0) return null;

  const syncNow = async () => {
    setSyncing(true);
    try {
      for (const item of repo.listInState('QUEUED_FOR_SIGNING')) repo.clearRetryBackoff(item.id);
      await backfillCertificateNumbers(accessToken);
      await processQueue(accessToken);
    } finally {
      setSyncing(false);
      refresh();
      onQueueDrained?.();
    }
  };

  const message = !online
    ? inFlight > 0
      ? `Offline — ${inFlight} certificate${inFlight === 1 ? '' : 's'} queued; signing resumes when connected.`
      : 'Offline — drafts stay safe on this device.'
    : inFlight > 0
      ? `${inFlight} certificate${inFlight === 1 ? '' : 's'} waiting to sign.`
      : 'Finishing audit-log sync…';

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: online ? '#e7eef7' : '#f7efdd',
        borderBottomWidth: 1,
        borderColor: colors.line,
      }}
    >
      <Text style={{ flex: 1, color: colors.ink, fontSize: 13 }}>{message}</Text>
      {online ? (
        <Pressable
          onPress={syncNow}
          disabled={syncing}
          style={{
            borderWidth: 1,
            borderColor: colors.blue,
            borderRadius: 6,
            paddingHorizontal: 12,
            paddingVertical: 6,
            opacity: syncing ? 0.5 : 1,
          }}
        >
          {syncing ? (
            <ActivityIndicator size="small" color={colors.blue} />
          ) : (
            <Text style={{ color: colors.blue, fontWeight: '600', fontSize: 13 }}>Sync now</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

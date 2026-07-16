import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import type { CertificateState } from '@prowalco/schema';
import { listWorkOrders, WorkOrderSummary } from '../src/api/client';
import { useAuth } from '../src/auth/AuthContext';
import { fetchThrough } from '../src/db/cache';
import { Badge, Button, colors, styles } from '../src/components/ui';
import * as repo from '../src/db/certificateRepo';

const STATE_TONE: Record<CertificateState, 'ok' | 'warn' | 'bad' | 'muted'> = {
  DRAFT: 'muted',
  READY_TO_SIGN: 'warn',
  QUEUED_FOR_SIGNING: 'warn',
  UPLOADING: 'warn',
  SIGNED: 'ok',
  SYNCED: 'ok',
};

export default function HomeScreen() {
  const { identity, accessToken, loading, signOut } = useAuth();
  const router = useRouter();
  const [workOrders, setWorkOrders] = useState<WorkOrderSummary[]>([]);
  const [issued, setIssued] = useState<repo.CertificateRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setIssued(repo.listAll().filter((c) => c.state === 'SIGNED' || c.state === 'SYNCED'));
    setRefreshing(true);
    try {
      const wo = await fetchThrough('workorders', () => listWorkOrders(accessToken));
      setWorkOrders(wo);
    } catch {
      // offline with no cache — leave the list empty
    } finally {
      setRefreshing(false);
    }
  }, [accessToken]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!loading && !identity) return <Redirect href="/" />;

  return (
    <View style={styles.screen}>
      <View style={{ padding: 12 }}>
        <Text style={{ color: colors.muted }}>Signed in as {identity?.name}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button title={refreshing ? 'Refreshing…' : 'Refresh'} kind="secondary" onPress={load} busy={refreshing} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="My profile" kind="secondary" onPress={() => router.push('/profile')} />
          </View>
        </View>
      </View>
      <FlatList
        data={workOrders}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ paddingBottom: 12 }}
        ListHeaderComponent={
          <Text style={{ marginHorizontal: 12, marginTop: 4, fontWeight: '700', color: colors.ink }}>
            My work orders
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/workorder/[id]', params: { id: item.id } })}
          >
            <View style={[styles.card, { flexDirection: 'row', alignItems: 'center' }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>{item.reference}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {item.site.customerName} · {item.site.siteName}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  {item.dispenserIds.length} dispenser(s)
                  {item.scheduledDate ? ` · ${item.scheduledDate}` : ''}
                </Text>
              </View>
              <Badge text={item.status.replaceAll('_', ' ')} tone="muted" />
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: colors.muted, marginTop: 20 }}>
            No work orders assigned. Pull refresh when online.
          </Text>
        }
        ListFooterComponent={
          <View>
            <Text style={{ marginHorizontal: 12, marginTop: 16, fontWeight: '700', color: colors.ink }}>
              Issued certificates
            </Text>
            {issued.length === 0 ? (
              <Text style={{ marginHorizontal: 12, color: colors.muted, marginTop: 6 }}>None yet.</Text>
            ) : (
              issued.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() =>
                    router.push({ pathname: '/verification/[id]/issued', params: { id: item.id } })
                  }
                >
                  <View style={[styles.card, { flexDirection: 'row', alignItems: 'center' }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '700', color: colors.ink }}>
                        {item.certificateNumber ?? '(no number)'}
                      </Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>
                        {(item.form.site as { customerName?: string } | undefined)?.customerName ?? ''}
                      </Text>
                    </View>
                    <Badge text={item.state.replaceAll('_', ' ')} tone={STATE_TONE[item.state]} />
                  </View>
                </Pressable>
              ))
            )}
          </View>
        }
      />
      <View style={{ padding: 12 }}>
        <Button title="Sign out" kind="secondary" onPress={signOut} />
      </View>
    </View>
  );
}

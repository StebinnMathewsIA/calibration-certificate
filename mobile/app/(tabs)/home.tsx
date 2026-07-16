import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { listWorkOrders, WorkOrderSummary } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { fetchThrough } from '../../src/db/cache';
import { Badge, Button, colors, styles } from '../../src/components/ui';

export default function HomeScreen() {
  const { identity, accessToken, loading } = useAuth();
  const router = useRouter();
  const [workOrders, setWorkOrders] = useState<WorkOrderSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
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
        <Button
          title={refreshing ? 'Refreshing…' : 'Refresh work orders'}
          kind="secondary"
          onPress={load}
          busy={refreshing}
        />
      </View>
      <FlatList
        data={workOrders}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <Text style={{ marginHorizontal: 12, marginTop: 4, fontWeight: '700', color: colors.ink }}>
            My open work orders
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
            No open work orders. Pull refresh when online.
          </Text>
        }
      />
    </View>
  );
}

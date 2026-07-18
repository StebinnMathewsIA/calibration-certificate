import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { listSites, SiteResolved } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { fetchThrough } from '../../src/db/cache';
import { GreetingHeader } from '../../src/components/GreetingHeader';
import { SyncBanner } from '../../src/components/SyncBanner';
import { colors, styles } from '../../src/components/ui';

export default function SitesScreen() {
  const { identity, accessToken, loading } = useAuth();
  const router = useRouter();
  const [sites, setSites] = useState<SiteResolved[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const s = await fetchThrough('sites', () => listSites(accessToken));
      setSites(s);
    } catch {
      // offline with no cache
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
      <GreetingHeader
        title="Sites"
        subtitle={
          refreshing && sites.length === 0
            ? 'Checking sites…'
            : `${sites.length} site${sites.length === 1 ? '' : 's'} on record`
        }
        onRefresh={load}
        refreshing={refreshing}
      />
      <SyncBanner />
      <FlatList
        data={sites}
        keyExtractor={(x) => x.id}
        // The in-flow tab bar reserves its own space now (#45).
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <Text style={{ marginHorizontal: 12, marginTop: 4, fontWeight: '700', color: colors.ink }}>
            Sites &amp; certificates
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/site/[id]', params: { id: item.id } })}
          >
            <View style={styles.card}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>{item.siteName}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{item.customerName}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{item.address}</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: colors.muted, marginTop: 20 }}>
            No sites yet.
          </Text>
        }
      />
    </View>
  );
}

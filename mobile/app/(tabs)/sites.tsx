/**
 * Sites tab in the Home card language (#168, owner request). Two
 * sections: the sites carrying the technician's open work on top (most
 * jobs first), then the whole register underneath, because pulling up
 * documents or past work for ANY site is the point of the tab. An oil
 * company chip row and a search field filter both sections together.
 *
 * The register is nearly three thousand rows, so everything renders
 * through one virtualised FlatList: section headings are rows too.
 */
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  SiteResolved,
  WorkOrderRecord,
  listSites,
  listWorkOrderRecords,
} from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { fetchThrough, readCache, writeCache } from '../../src/db/cache';
import { GreetingHeader } from '../../src/components/GreetingHeader';
import { OilDisc } from '../../src/components/home/OilDisc';
import { SyncBanner } from '../../src/components/SyncBanner';
import { colors, fonts, styles } from '../../src/components/ui';

type Row =
  | { kind: 'heading'; key: string; title: string }
  | { kind: 'site'; key: string; site: SiteResolved; openCount: number };

/** "Astron Energy (Pty) Ltd" reads as "Astron Energy" on a chip. */
const chipLabel = (oil: string): string =>
  oil.replace(/\s*\((pty|proprietary)\)\s*(ltd|limited)\.?\s*$/i, '').trim();

export default function SitesScreen() {
  const { identity, accessToken, loading } = useAuth();
  const router = useRouter();
  const [sites, setSites] = useState<SiteResolved[]>([]);
  const [records, setRecords] = useState<WorkOrderRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [oil, setOil] = useState<string | null>(null);

  const load = useCallback(
    async (force = false) => {
      setRefreshing(true);
      fetchThrough<WorkOrderRecord[]>('wo:records', () => listWorkOrderRecords(accessToken), {
        onFresh: setRecords,
      })
        .then(setRecords)
        .catch(() => {});
      try {
        // The register is 2,872 rows and changes rarely; refetching it on
        // every focus both wastes forecourt data and exposes the tab to
        // the server's 8 second statement budget on a bad night (#171).
        // Once a day, or on an explicit pull refresh.
        const fetchedAt = readCache<string>('sites:fetchedAt');
        const fresh =
          !!fetchedAt && Date.now() - new Date(fetchedAt).getTime() < 24 * 60 * 60 * 1000;
        const cached = readCache<SiteResolved[]>('sites');
        if (!force && fresh && cached && cached.length > 100) {
          setSites(cached);
        } else {
          const s = await fetchThrough('sites', () => listSites(accessToken), { force: true });
          setSites(s);
          if (s.length > 100) writeCache('sites:fetchedAt', new Date().toISOString());
        }
      } catch {
        const cached = readCache<SiteResolved[]>('sites');
        if (cached) setSites(cached);
      } finally {
        setRefreshing(false);
      }
    },
    [accessToken],
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  /** Open jobs per site: anything on my list not yet signed off. */
  const openBySite = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of records) {
      if (!r.siteId || r.lifecycle?.state === 'signed_off') continue;
      m.set(r.siteId, (m.get(r.siteId) ?? 0) + 1);
    }
    return m;
  }, [records]);

  /** The chip row: every oil company on the register, biggest first. */
  const oils = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sites) {
      const o = (s.oilCompany ?? '').trim();
      if (o) counts.set(o, (counts.get(o) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([o]) => o);
  }, [sites]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (s: SiteResolved) => {
      if (oil && (s.oilCompany ?? '').trim() !== oil) return false;
      if (!q) return true;
      return [s.siteName, s.customerName, s.address, s.id, s.oilCompany ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q);
    };
    const active: Row[] = [];
    const rest: Row[] = [];
    for (const s of sites) {
      if (!match(s)) continue;
      const openCount = openBySite.get(s.id) ?? 0;
      const row: Row = { kind: 'site', key: s.id, site: s, openCount };
      if (openCount > 0) active.push(row);
      else rest.push(row);
    }
    active.sort((a, b) =>
      a.kind === 'site' && b.kind === 'site' ? b.openCount - a.openCount : 0,
    );
    rest.sort((a, b) =>
      a.kind === 'site' && b.kind === 'site'
        ? a.site.siteName.localeCompare(b.site.siteName)
        : 0,
    );
    const out: Row[] = [];
    if (active.length > 0) {
      out.push({ kind: 'heading', key: 'h-active', title: 'Your active sites' });
      out.push(...active);
    }
    if (rest.length > 0) {
      out.push({ kind: 'heading', key: 'h-all', title: 'All sites' });
      out.push(...rest);
    }
    return out;
  }, [sites, openBySite, query, oil]);

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
        onRefresh={() => load(true)}
        refreshing={refreshing}
      />
      <SyncBanner />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        // The in-flow tab bar reserves its own space now (#45).
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={16}
        windowSize={7}
        ListHeaderComponent={
          <View>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search site, customer, town or number"
              placeholderTextColor={colors.muted}
              autoCorrect={false}
              accessibilityLabel="Search sites"
              style={{
                marginHorizontal: 12,
                marginTop: 4,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: 12,
                backgroundColor: '#fff',
                paddingHorizontal: 12,
                paddingVertical: 9,
                fontSize: 14,
                color: colors.ink,
              }}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 12, gap: 6, paddingVertical: 10 }}
            >
              {[null, ...oils].map((o) => {
                const on = oil === o;
                return (
                  <Pressable
                    key={o ?? 'all'}
                    onPress={() => setOil(on ? null : o)}
                    accessibilityRole="button"
                    accessibilityLabel={o ? `Filter by ${chipLabel(o)}` : 'Show all oil companies'}
                    accessibilityState={{ selected: on }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingVertical: 5,
                      paddingLeft: o ? 5 : 12,
                      paddingRight: 12,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: on ? colors.navy : colors.line,
                      backgroundColor: on ? colors.navy : '#fff',
                    }}
                  >
                    {o ? <OilDisc customerName={o} size={22} /> : null}
                    <Text
                      style={{
                        fontSize: 12.5,
                        fontFamily: fonts.bodyMedium,
                        color: on ? '#fff' : colors.ink,
                      }}
                    >
                      {o ? chipLabel(o) : 'All'}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        }
        renderItem={({ item }) =>
          item.kind === 'heading' ? (
            <Text
              style={{
                marginHorizontal: 12,
                marginTop: 10,
                marginBottom: 4,
                fontFamily: fonts.heading,
                color: colors.ink,
                fontSize: 18,
              }}
            >
              {item.title}
            </Text>
          ) : (
            <Pressable
              onPress={() => router.push({ pathname: '/site/[id]', params: { id: item.site.id } })}
              accessibilityRole="button"
              accessibilityLabel={`Open site ${item.site.siteName}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                backgroundColor: '#fff',
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.line,
                paddingVertical: 10,
                paddingHorizontal: 10,
                marginHorizontal: 12,
                marginBottom: 8,
              }}
            >
              <OilDisc customerName={item.site.oilCompany ?? item.site.customerName} size={40} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={{ fontFamily: fonts.heading, fontSize: 14.5, color: colors.ink }}
                  numberOfLines={1}
                >
                  {item.site.siteName}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
                  {[item.site.customerName, item.site.address].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {item.openCount > 0 ? (
                <View
                  style={{
                    backgroundColor: colors.greenTint,
                    borderRadius: 999,
                    paddingVertical: 3,
                    paddingHorizontal: 9,
                  }}
                >
                  <Text style={{ color: colors.greenText, fontSize: 12, fontFamily: fonts.bodyMedium }}>
                    {item.openCount} job{item.openCount === 1 ? '' : 's'}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          )
        }
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: colors.muted, marginTop: 20 }}>
            {sites.length === 0
              ? 'No sites yet. Pull refresh when online.'
              : 'Nothing matches that search.'}
          </Text>
        }
      />
    </View>
  );
}

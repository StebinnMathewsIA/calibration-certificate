/**
 * Insights tab (#56, Arch v2 phase 5) — the technician's own numbers plus a
 * PII-free company snapshot, scoped server-side by the caller's JWT.
 * Reads the offline mirror first like every other screen.
 */
import { Redirect, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Insights, getInsights } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { fetchThrough } from '../../src/db/cache';
import { GreetingHeader } from '../../src/components/GreetingHeader';
import { SyncBanner } from '../../src/components/SyncBanner';
import { SectionCard, colors, fonts, styles } from '../../src/components/ui';

function Stat({ label, value, wide }: { label: string; value: string | number; wide?: boolean }) {
  return (
    <View
      style={{
        flexBasis: wide ? '100%' : '47%',
        flexGrow: 1,
        backgroundColor: colors.greenTint,
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 12,
      }}
    >
      <Text style={{ fontSize: 22, fontFamily: fonts.bodyMedium, color: colors.ink }}>{value}</Text>
      <Text style={{ fontSize: 12, color: colors.muted }}>{label}</Text>
    </View>
  );
}

/** Dependency-free monthly bar chart. */
function Bars({ data }: { data: { month: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 110, marginTop: 8 }}>
      {data.map((d) => (
        <View key={d.month} style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontSize: 11, color: colors.ink }}>{d.count}</Text>
          <View
            style={{
              width: '70%',
              height: Math.max(4, (d.count / max) * 72),
              backgroundColor: colors.green,
              borderRadius: 4,
              marginTop: 2,
            }}
          />
          <Text style={{ fontSize: 10, color: colors.muted, marginTop: 4 }}>
            {d.month.slice(5)}
          </Text>
        </View>
      ))}
    </View>
  );
}

export default function InsightsScreen() {
  const { identity, accessToken, loading } = useAuth();
  const [insights, setInsights] = useState<Insights | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setInsights(await fetchThrough('insights', () => getInsights(accessToken)));
    } catch {
      // offline with no cache yet
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

  const i = insights;
  return (
    <View style={styles.screen}>
      <GreetingHeader
        title="Insights"
        subtitle={
          i
            ? `${i.me.openTotal} open · ${i.me.completedLast30} completed in 30 days`
            : 'Syncing your numbers…'
        }
        onRefresh={load}
        refreshing={refreshing}
      />
      <SyncBanner />
      {!i ? (
        <Text style={{ padding: 16, color: colors.muted }}>
          Insights appear after the first sync on signal.
        </Text>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          <SectionCard title="My workload">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Stat label="Open work orders" value={i.me.openTotal} />
              <Stat label="Open sites" value={i.me.openSites} />
              <Stat label="Completed, last 30 days" value={i.me.completedLast30} wide />
            </View>
            {Object.keys(i.me.openByStatus).length > 0 ? (
              <View style={{ marginTop: 10 }}>
                {Object.entries(i.me.openByStatus)
                  .sort(([, a], [, b]) => b - a)
                  .map(([status, n]) => (
                    <View
                      key={status}
                      style={{
                        flexDirection: 'row',
                        borderTopWidth: 1,
                        borderColor: colors.line,
                        paddingVertical: 6,
                      }}
                    >
                      <Text style={{ flex: 1, color: colors.ink, fontSize: 13 }}>{status}</Text>
                      <Text style={{ color: colors.muted, fontSize: 13 }}>{n}</Text>
                    </View>
                  ))}
              </View>
            ) : null}
          </SectionCard>

          {i.me.monthlyCompleted.length > 0 ? (
            <SectionCard title="Completions per month">
              <Bars data={i.me.monthlyCompleted} />
            </SectionCard>
          ) : null}

          <SectionCard title="My certificates">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Stat label="Issued by me" value={i.certificates.issuedByMe} />
              <Stat label="Last 30 days" value={i.certificates.last30ByMe} />
              <Stat label="Expiring within 60 days" value={i.certificates.expiringSoon60} wide />
            </View>
            {i.certificates.lastIssuedAt ? (
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>
                Last issued {i.certificates.lastIssuedAt.slice(0, 10)}
              </Text>
            ) : null}
          </SectionCard>

          <SectionCard title="Across Prowalco">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Stat label="Open work orders" value={i.company.openTotal} />
              <Stat label="Technicians with open work" value={i.company.techniciansWithOpen} />
              <Stat label="Sites with open work" value={i.company.sitesWithOpen} />
              <Stat label="Certificates, last 30 days" value={i.company.certificatesLast30} />
            </View>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>
              Updated {i.generatedAt.slice(0, 16).replace('T', ' ')} UTC
            </Text>
          </SectionCard>
        </ScrollView>
      )}
    </View>
  );
}

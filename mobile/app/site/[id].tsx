import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { DispenserResolved, SiteResolved, getSite, listSiteDispensers } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { Badge, SectionCard, colors, styles } from '../../src/components/ui';
import { fetchThrough } from '../../src/db/cache';
import {
  CERT_LABEL,
  CERT_TONE,
  DispenserCert,
  certStatusByDispenser,
} from '../../src/certs/certStatus';

export default function SiteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accessToken } = useAuth();
  const router = useRouter();
  const [site, setSite] = useState<SiteResolved | null>(null);
  const [dispensers, setDispensers] = useState<DispenserResolved[]>([]);
  const [certs, setCerts] = useState<Record<string, DispenserCert>>({});

  const load = useCallback(async () => {
    setCerts(certStatusByDispenser());
    try {
      const [s, ds] = await Promise.all([
        fetchThrough(`site:${id}`, () => getSite(accessToken, id)),
        fetchThrough(`site-dispensers:${id}`, () => listSiteDispensers(accessToken, id)),
      ]);
      setSite(s);
      setDispensers(ds);
    } catch (err) {
      Alert.alert('Could not load site', err instanceof Error ? err.message : String(err));
    }
  }, [accessToken, id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!site) return <Text style={{ padding: 16 }}>Loading…</Text>;

  const active = dispensers.filter((d) => d.status !== 'retired');
  const retired = dispensers.filter((d) => d.status === 'retired');

  const row = (d: DispenserResolved) => {
    const c = certs[d.id] ?? { state: 'none' as const };
    return (
      <View
        key={d.id}
        style={{ borderTopWidth: 1, borderColor: colors.line, paddingVertical: 8 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '600', color: colors.ink }}>
              {d.make || 'Unknown'} {d.model} {d.serialNumber ? `· ${d.serialNumber}` : ''}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              {d.id}
              {c.expiryDate ? ` · expires ${c.expiryDate}` : ''}
              {c.certificateNumber ? ` · ${c.certificateNumber}` : ''}
            </Text>
          </View>
          <Badge text={CERT_LABEL[c.state]} tone={CERT_TONE[c.state]} />
        </View>
        {c.recordId ? (
          <Text
            onPress={() =>
              router.push({ pathname: '/verification/[id]/issued', params: { id: c.recordId! } })
            }
            style={{
              color: colors.blueText,
              textDecorationLine: 'underline',
              fontSize: 12,
              marginTop: 4,
            }}
          >
            View / share certificate →
          </Text>
        ) : null}
      </View>
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <SectionCard title={site.siteName}>
        <Text style={{ color: colors.ink }}>{site.customerName}</Text>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{site.address}</Text>
        {site.telephone ? (
          <Text style={{ color: colors.muted, fontSize: 13 }}>Tel: {site.telephone}</Text>
        ) : null}
      </SectionCard>

      <SectionCard title="Dispensers & certificates">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>
          Certificate status is based on the certificates issued from this device.
        </Text>
        {active.length === 0 ? (
          <Text style={{ color: colors.muted, marginTop: 6 }}>No active dispensers.</Text>
        ) : (
          active.map(row)
        )}
      </SectionCard>

      {retired.length > 0 ? (
        <SectionCard title="Retired dispensers">{retired.map(row)}</SectionCard>
      ) : null}
    </ScrollView>
  );
}

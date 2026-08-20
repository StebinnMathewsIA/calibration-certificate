/** Detail for one past work order at a site (#192). Renders instantly
 * from the summary the list row already carried (params), then enriches
 * with the FieldOps mirror's full record when the RPC lands. Unknown
 * references (for example the [TEST]# entities that exist only in our
 * store) keep the summary with a plain note. */
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { PastWorkDetail, getPastWorkDetail } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { SectionCard, colors, fonts, styles } from '../../src/components/ui';

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontSize: 11.5, color: colors.muted, marginBottom: 1 }}>{label}</Text>
      <Text style={{ fontSize: 13.5, color: colors.ink }}>{value}</Text>
    </View>
  );
}

export default function PastWorkScreen() {
  const { ref, when, what } = useLocalSearchParams<{ ref: string; when?: string; what?: string }>();
  const { accessToken } = useAuth();
  const [detail, setDetail] = useState<PastWorkDetail | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    getPastWorkDetail(accessToken, String(ref))
      .then((d) => {
        setDetail(d);
        setSettled(true);
      })
      .catch(() => setSettled(true));
  }, [accessToken, ref]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <SectionCard title={`Work order ${ref}`}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.ink }}>{ref}</Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>
            {detail?.completedOn?.slice(0, 10) ?? when ?? ''}
          </Text>
        </View>
        <Row label="Status" value={detail?.status} />
        <Row label="Technician" value={detail?.technician} />
        <Row label="Asset" value={detail?.assetCode} />
        <Row label="Received" value={detail?.receivedOn?.slice(0, 10)} />
        <Row label="Completed" value={detail?.completedOn?.slice(0, 10)} />
        <Row label="Work required" value={detail?.workRequired} />
        <Row label="Work performed" value={detail?.workPerformed} />
        {!detail ? (
          <>
            <Row label="Summary" value={what} />
            {settled ? (
              <Text style={{ fontSize: 12, color: colors.muted }}>
                OnKey has no further detail for this reference.
              </Text>
            ) : (
              <Text style={{ fontSize: 12, color: colors.muted }}>Fetching the full record...</Text>
            )}
          </>
        ) : null}
      </SectionCard>
    </ScrollView>
  );
}

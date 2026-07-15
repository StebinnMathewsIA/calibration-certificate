import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { Verification } from '@prowalco/schema';
import { Badge, Button, SectionCard, colors, styles } from '../../../src/components/ui';
import * as repo from '../../../src/db/certificateRepo';

export default function IssuedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [record, setRecord] = useState(() => repo.getById(id));

  useFocusEffect(
    useCallback(() => {
      setRecord(repo.getById(id));
    }, [id]),
  );

  if (!record) return <Text>Not found</Text>;
  const v = record.form as Partial<Verification>;

  const share = async () => {
    if (!record.signedPdfUri) return;
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(record.signedPdfUri, { mimeType: 'application/pdf' });
    } else {
      Alert.alert('Sharing not available on this device');
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <SectionCard title={record.certificateNumber ?? ''}>
        <Badge text={record.state === 'SYNCED' ? 'ISSUED & SYNCED' : 'ISSUED'} tone="ok" />
        <Text style={{ marginTop: 8, color: colors.ink }}>{v.site?.customerName}</Text>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{v.site?.siteName}</Text>
        <Text style={{ color: colors.muted, fontSize: 13 }}>Dispenser: {v.dispenser?.serialNumber}</Text>
        <Text style={{ color: colors.muted, fontSize: 13, marginTop: 6 }}>Signed at: {record.signedAt}</Text>
        <Text style={{ color: colors.muted, fontSize: 11 }} selectable>
          Signature ID: {record.signatureId}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 11 }} selectable>
          SHA-256: {record.signedPdfSha256}
        </Text>
      </SectionCard>
      <SectionCard title="Signed verification certificate">
        <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 6 }}>
          This PDF carries the PAdES digital signature and (when configured) an RFC 3161 trusted
          timestamp. Only this signed file is a certificate — never distribute unsigned output.
        </Text>
        <Button title="Share / open signed PDF" onPress={share} disabled={!record.signedPdfUri} />
      </SectionCard>
    </ScrollView>
  );
}

import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useFocusEffect } from 'expo-router';
import type { Verification } from '@prowalco/schema';
import { verificationSchema } from '@prowalco/schema';
import { Badge, Button, SectionCard, colors, styles } from '../../../src/components/ui';
import * as repo from '../../../src/db/certificateRepo';
import { certificateHtml } from '../../../src/pdf/certificateHtml';

export default function IssuedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [record, setRecord] = useState(() => repo.getById(id));
  const [showVerification, setShowVerification] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setRecord(repo.getById(id));
    }, [id]),
  );

  const v = record ? (record.form as Partial<Verification>) : null;

  // Content preview rendered from the same data as the signed PDF (Android
  // WebView cannot display local PDFs; the shareable file is always the
  // signed PDF itself).
  const previewHtml = useMemo(() => {
    if (!v || !verificationSchema.safeParse(v).success) return null;
    return certificateHtml(v as Verification).replace(
      '<head>',
      '<head><meta name="viewport" content="width=1123, initial-scale=0.34, minimum-scale=0.2, maximum-scale=3" />',
    );
  }, [v]);

  if (!record || !v) return <Text style={{ padding: 16 }}>Not found</Text>;

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
        <Badge filled text={record.state === 'SYNCED' ? 'ISSUED & SYNCED' : 'ISSUED'} tone="ok" />
        <Text style={{ marginTop: 8, color: colors.ink, fontSize: 15, fontWeight: '600' }}>
          {v.site?.customerName} · {v.site?.siteName}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 13 }}>
          Dispenser: {v.dispenser?.makeModel} · S/N {v.dispenser?.serialNumber}
        </Text>
        <Text style={{ color: colors.ink, fontSize: 13, marginTop: 8 }}>
          Digitally signed and timestamped — the signature verifies in Adobe Reader. Only the
          signed PDF is a certificate.
        </Text>
        <Button title="Share signed PDF" onPress={share} disabled={!record.signedPdfUri} />
      </SectionCard>

      {previewHtml ? (
        <SectionCard title="Certificate">
          <View
            style={{
              height: 420,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            <WebView source={{ html: previewHtml }} originWhitelist={['*']} setSupportMultipleWindows={false} />
          </View>
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
            Content preview — share the signed PDF for the authoritative document.
          </Text>
        </SectionCard>
      ) : null}

      <SectionCard title="Verification details">
        <Pressable onPress={() => setShowVerification((s) => !s)} hitSlop={8}>
          <Text style={{ color: colors.blue, fontWeight: '600', fontSize: 13 }}>
            {showVerification ? 'Hide' : 'Show'} signature ID, hash and timestamps
          </Text>
        </Pressable>
        {showVerification ? (
          <View style={{ marginTop: 8 }}>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Signed at</Text>
            <Text style={{ color: colors.ink, fontSize: 13, marginBottom: 6 }} selectable>
              {record.signedAt}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Signature ID</Text>
            <Text style={{ color: colors.ink, fontSize: 13, marginBottom: 6 }} selectable>
              {record.signatureId}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>SHA-256 of signed PDF</Text>
            <Text style={{ color: colors.ink, fontSize: 12 }} selectable>
              {record.signedPdfSha256}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>
              The PDF carries the PAdES digital signature and (when configured) an RFC 3161
              trusted timestamp.
            </Text>
          </View>
        ) : null}
      </SectionCard>
    </ScrollView>
  );
}

/**
 * Certificate archive search (#72) — role holders only. Searches EVERY
 * certificate in the company archive by number, site, customer, dispenser
 * or VO name; each row can fetch and share the sealed PDF.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import {
  CertHistoryEntry,
  fetchCertificatePdf,
  searchCertificates,
} from '../src/api/client';
import { useAuth } from '../src/auth/AuthContext';
import { Badge, SectionCard, colors, styles, styles as ui } from '../src/components/ui';

type Row = CertHistoryEntry & { siteName: string; customerName: string };

export default function ArchiveScreen() {
  const { accessToken } = useAuth();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(
    (q: string) => {
      searchCertificates(accessToken, q)
        .then((r) => setRows(r))
        .catch(() => {});
    },
    [accessToken],
  );

  useEffect(() => {
    search('');
  }, [search]);

  const onQuery = (q: string) => {
    setQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(q), 350);
  };

  const share = async (certificateNumber: string) => {
    setSharing(certificateNumber);
    try {
      const { signedPdfBase64 } = await fetchCertificatePdf(accessToken, certificateNumber);
      const path = `${FileSystem.cacheDirectory}${certificateNumber}.pdf`;
      await FileSystem.writeAsStringAsync(path, signedPdfBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await Sharing.shareAsync(path, { mimeType: 'application/pdf' });
    } catch (err) {
      Alert.alert(
        'Could not fetch certificate',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setSharing(null);
    }
  };

  if (rows === null) {
    return (
      <Text style={{ padding: 16, color: colors.muted }}>
        Manager or admin access required (or still loading).
      </Text>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <SectionCard title="Certificate archive">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 6 }}>
          Every certificate ever issued, newest first. Search by certificate number, site,
          customer, dispenser or VO name.
        </Text>
        <TextInput
          style={{
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: 10,
            paddingHorizontal: 10,
            paddingVertical: 8,
            marginBottom: 6,
            color: colors.ink,
            backgroundColor: '#fff',
          }}
          value={query}
          onChangeText={onQuery}
          placeholder="PWCJHB… / Engen / EQ123 / S. Mathews"
          autoCapitalize="none"
        />
        {rows.length === 0 ? (
          <Text style={{ color: colors.muted, marginTop: 6 }}>No certificates match.</Text>
        ) : (
          rows.map((h) => (
            <View
              key={h.certificateNumber}
              style={{ borderTopWidth: 1, borderColor: colors.line, paddingVertical: 8 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={[ui.mono, { fontWeight: '600', color: colors.ink, fontSize: 13 }]}>
                    {h.certificateNumber}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {[h.customerName, h.siteName].filter(Boolean).join(' · ')}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {h.dispenserId ? `${h.dispenserId} · ` : ''}
                    {h.verificationDate ?? h.signedAt.slice(0, 10)}
                    {h.voName ? ` · ${h.voName}` : ''}
                    {h.expiryDate ? ` · expires ${h.expiryDate}` : ''}
                  </Text>
                </View>
                <Badge
                  text={h.status === 'issued' ? 'Issued' : h.status}
                  tone={h.status === 'issued' ? 'ok' : 'warn'}
                />
              </View>
              <Text
                onPress={() => (sharing ? undefined : void share(h.certificateNumber))}
                style={{
                  color: colors.blueText,
                  textDecorationLine: 'underline',
                  fontSize: 12,
                  marginTop: 4,
                }}
              >
                {sharing === h.certificateNumber
                  ? 'Fetching sealed PDF…'
                  : 'Download & share sealed PDF →'}
              </Text>
            </View>
          ))
        )}
      </SectionCard>
    </ScrollView>
  );
}

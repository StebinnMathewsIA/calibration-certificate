import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  CertHistoryEntry,
  DispenserResolved,
  SiteResolved,
  addDispenser,
  fetchCertificatePdf,
  getSite,
  getSiteHistory,
  listSiteDispensers,
} from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { BarcodeScannerModal } from '../../src/components/BarcodeScanner';
import { Badge, Button, SectionCard, colors, styles, styles as ui } from '../../src/components/ui';
import { fetchThrough } from '../../src/db/cache';
import { MiniMap } from '../../src/components/MiniMap';
import {
  CERT_LABEL,
  CERT_TONE,
  DispenserCert,
  certStatusByDispenser,
} from '../../src/certs/certStatus';

export default function SiteDetailScreen() {
  // workOrderId rides along when this screen is opened from a work order
  // (#151), so a verification started here still links to the job.
  const { id, workOrderId } = useLocalSearchParams<{ id: string; workOrderId?: string }>();
  const { accessToken } = useAuth();
  const router = useRouter();
  const [site, setSite] = useState<SiteResolved | null>(null);
  const [dispensers, setDispensers] = useState<DispenserResolved[]>([]);
  const [certs, setCerts] = useState<Record<string, DispenserCert>>({});
  const [history, setHistory] = useState<CertHistoryEntry[]>([]);
  const [sharingCert, setSharingCert] = useState<string | null>(null);
  // Adding a dispenser lives HERE now (#209): our registry is the only
  // source of assets, so the site screen must be able to grow it.
  const [adding, setAdding] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [form, setForm] = useState({
    make: 'Tatsuno',
    model: '',
    serialNumber: '',
    saApprovalNumber: '',
  });

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
    // Archive history (#68) — every device's certificates, not just this one.
    // Best-effort: offline shows the cached copy from the last view.
    try {
      setHistory(await fetchThrough(`site-history:${id}`, () => getSiteHistory(accessToken, id)));
    } catch {
      // no cache yet and offline — the section simply shows empty
    }
  }, [accessToken, id]);

  const sharePast = async (entry: CertHistoryEntry) => {
    setSharingCert(entry.certificateNumber);
    try {
      const { signedPdfBase64 } = await fetchCertificatePdf(accessToken, entry.certificateNumber);
      const path = `${FileSystem.cacheDirectory}${entry.certificateNumber}.pdf`;
      await FileSystem.writeAsStringAsync(path, signedPdfBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await Sharing.shareAsync(path, { mimeType: 'application/pdf' });
    } catch (err) {
      Alert.alert(
        'Could not fetch certificate',
        'Downloading a past certificate needs a connection.\n\n' +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setSharingCert(null);
    }
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const submitAdd = async () => {
    if (!form.model.trim() || !form.serialNumber.trim() || !form.saApprovalNumber.trim()) {
      Alert.alert(
        'Missing details',
        'Make, model, serial number and SA approval number are required.',
      );
      return;
    }
    setAddBusy(true);
    try {
      await addDispenser(accessToken, { siteId: String(id), ...form });
      setForm({ make: 'Tatsuno', model: '', serialNumber: '', saApprovalNumber: '' });
      setAdding(false);
      await load();
    } catch (err) {
      Alert.alert('Could not add dispenser', err instanceof Error ? err.message : String(err));
    } finally {
      setAddBusy(false);
    }
  };

  if (!site) return <Text style={{ padding: 16 }}>Loading…</Text>;

  const active = dispensers.filter((d) => d.status !== 'retired');
  const retired = dispensers.filter((d) => d.status === 'retired');

  /** Where a dispenser should open, decided from what is missing rather
   * than asked of the technician (#125). Identity first when we do not yet
   * know what the machine is; otherwise the component register, which is
   * where a verification is actually started. */
  const openDispenser = (d: DispenserResolved) => {
    const needsIdentity = !d.make || !d.model || !d.serialNumber;
    // The site id travels with the push (#151): the identity screen used
    // to receive nothing here, fetch the site with an undefined id, and
    // render an empty Site details block over a site we know perfectly well.
    router.push({
      pathname: needsIdentity ? '/dispenser/[id]/identity' : '/dispenser/[id]/register',
      params: workOrderId
        ? { id: d.id, siteId: String(id), workOrderId }
        : { id: d.id, siteId: String(id) },
    });
  };

  const row = (d: DispenserResolved, tappable = true) => {
    const c = certs[d.id] ?? { state: 'none' as const };
    const needsIdentity = !d.make || !d.model || !d.serialNumber;
    return (
      <Pressable
        key={d.id}
        onPress={tappable ? () => openDispenser(d) : undefined}
        disabled={!tappable}
        accessibilityRole={tappable ? 'button' : undefined}
        accessibilityLabel={
          tappable
            ? `Open ${d.make || 'dispenser'} ${d.model} ${d.id}`
            : undefined
        }
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
        {/* Said out loud, not left to be discovered by tapping hopefully.
            This row used to offer nothing at all unless a certificate
            already existed, which stopped the technician one tap into the
            flow the button promised. */}
        {tappable ? (
          <Text style={{ color: colors.blueText, fontSize: 12, marginTop: 4 }}>
            {needsIdentity ? 'Complete identity to verify →' : 'Start verification →'}
          </Text>
        ) : null}
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
      </Pressable>
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
        <MiniMap gpsWkt={site.gpsLocation} address={site.address} />
      </SectionCard>

      <SectionCard title="Dispensers & certificates">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>
          Certificate status is based on the certificates issued from this device.
        </Text>
        {active.length === 0 ? (
          <Text style={{ color: colors.muted, marginTop: 6 }}>
            No dispensers registered at this site yet. Add the first one to start a
            verification; it prefills every visit after this.
          </Text>
        ) : (
          active.map((d) => row(d))
        )}
        {adding ? (
          <View style={{ marginTop: 10 }}>
            {(['make', 'model', 'serialNumber', 'saApprovalNumber'] as const).map((f) => (
              <View key={f} style={{ marginBottom: 6 }}>
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 3 }}>
                  {ADD_FIELD_LABELS[f]}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TextInput
                    style={[addInputStyle, { flex: 1 }]}
                    placeholder={ADD_FIELD_LABELS[f]}
                    value={form[f]}
                    onChangeText={(t) => setForm((prev) => ({ ...prev, [f]: t }))}
                  />
                  {f === 'serialNumber' ? (
                    <Text
                      onPress={() => setScanning(true)}
                      style={{
                        color: colors.navy,
                        fontWeight: '600',
                        borderWidth: 1.5,
                        borderColor: colors.navy,
                        borderRadius: 10,
                        paddingHorizontal: 12,
                        paddingVertical: 9,
                        overflow: 'hidden',
                      }}
                    >
                      Scan
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
            <Button title="Save dispenser" onPress={() => void submitAdd()} busy={addBusy} />
            <Button title="Cancel" kind="secondary" onPress={() => setAdding(false)} />
          </View>
        ) : (
          <Button title="Add a dispenser" kind="secondary" onPress={() => setAdding(true)} />
        )}
      </SectionCard>

      <BarcodeScannerModal
        visible={scanning}
        title="Scan the dispenser serial number"
        onClose={() => setScanning(false)}
        onScanned={(data) => {
          setScanning(false);
          setForm((prev) => ({ ...prev, serialNumber: data }));
        }}
      />

      {retired.length > 0 ? (
        <SectionCard title="Retired dispensers">{retired.map((d) => row(d, false))}</SectionCard>
      ) : null}

      <SectionCard title="Verification history">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>
          Every certificate issued at this site, by any technician, per dispenser.
        </Text>
        {history.length === 0 ? (
          <Text style={{ color: colors.muted, marginTop: 6 }}>
            No certificates on record for this site yet.
          </Text>
        ) : (
          history.map((h) => (
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
                    {h.dispenserId ? `${h.dispenserId} · ` : ''}
                    {h.verificationDate ?? h.signedAt.slice(0, 10)}
                    {h.voName ? ` · ${h.voName}` : ''}
                    {h.expiryDate ? ` · expires ${h.expiryDate}` : ''}
                  </Text>
                </View>
                <Badge
                  text={
                    h.documentType === 'rejection-certificate'
                      ? 'Rejection'
                      : h.status === 'issued'
                        ? 'Issued'
                        : h.status
                  }
                  tone={
                    h.documentType === 'rejection-certificate'
                      ? 'bad'
                      : h.status === 'issued'
                        ? 'ok'
                        : 'warn'
                  }
                />
              </View>
              <Text
                onPress={() => (sharingCert ? undefined : void sharePast(h))}
                style={{
                  color: colors.blueText,
                  textDecorationLine: 'underline',
                  fontSize: 12,
                  marginTop: 4,
                }}
              >
                {sharingCert === h.certificateNumber
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

const ADD_FIELD_LABELS: Record<'make' | 'model' | 'serialNumber' | 'saApprovalNumber', string> = {
  make: 'Make',
  model: 'Model',
  serialNumber: 'Serial number',
  saApprovalNumber: 'SA approval number',
};

const addInputStyle = {
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: 10,
  paddingHorizontal: 10,
  paddingVertical: 8,
  color: colors.ink,
  backgroundColor: '#fff',
} as const;

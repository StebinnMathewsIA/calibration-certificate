import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import {
  DispenserResolved,
  SiteResolved,
  editDispenser,
  getDispenser,
  getSite,
  upsertSite,
} from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { BarcodeScannerModal } from '../../../src/components/BarcodeScanner';
import { Button, SectionCard, colors } from '../../../src/components/ui';
import { FormScrollView } from '../../../src/components/FormScrollView';

function Field({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 3 }}>{label}</Text>
      <TextInput
        style={{
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: 10,
          paddingHorizontal: 10,
          paddingVertical: 8,
          color: colors.ink,
          backgroundColor: '#fff',
        }}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
      />
    </View>
  );
}

export default function DispenserIdentityScreen() {
  const { id, workOrderId, siteId } = useLocalSearchParams<{
    id: string;
    workOrderId: string;
    siteId: string;
  }>();
  const router = useRouter();
  const { accessToken } = useAuth();
  const [site, setSite] = useState<Partial<SiteResolved>>({});
  const [disp, setDisp] = useState<Partial<DispenserResolved>>({});
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [s, d] = await Promise.all([
          getSite(accessToken, siteId).catch(() => ({}) as SiteResolved),
          getDispenser(accessToken, id),
        ]);
        setSite(s);
        setDisp(d);
      } catch (err) {
        Alert.alert('Could not load', err instanceof Error ? err.message : String(err));
      } finally {
        setLoaded(true);
      }
    })();
  }, [accessToken, id, siteId]);

  if (!loaded) return <Text style={{ padding: 16 }}>Loading…</Text>;

  const saveAndContinue = async () => {
    if (!site.customerName || !site.siteName || !site.address) {
      Alert.alert('Site incomplete', 'Oil company, site name and address are required.');
      return;
    }
    if (!disp.make || !disp.model || !disp.serialNumber || !disp.saApprovalNumber) {
      Alert.alert('Dispenser incomplete', 'Make, model, serial number and SA approval number are required.');
      return;
    }
    setBusy(true);
    try {
      // Persist to our canonical store (seed -> fill -> persist).
      await upsertSite(accessToken, siteId, {
        id: siteId,
        customerName: site.customerName!,
        siteName: site.siteName!,
        address: site.address!,
        telephone: site.telephone ?? undefined,
      });
      await editDispenser(accessToken, id, {
        make: disp.make!,
        model: disp.model!,
        serialNumber: disp.serialNumber!,
        saApprovalNumber: disp.saApprovalNumber!,
        siteId,
      });
      router.push({
        pathname: '/dispenser/[id]/register',
        params: { id, workOrderId, siteId },
      });
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormScrollView>
      <SectionCard title="Site details">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>
          Prefilled from OnKey where available. Complete anything missing — it is saved and reused
          next visit.
        </Text>
        <Field label="Oil company" value={site.customerName ?? ''} onChangeText={(t) => setSite((p) => ({ ...p, customerName: t }))} />
        <Field label="Site / depot name (Name (User))" value={site.siteName ?? ''} onChangeText={(t) => setSite((p) => ({ ...p, siteName: t }))} />
        <Field label="Address" value={site.address ?? ''} onChangeText={(t) => setSite((p) => ({ ...p, address: t }))} />
        <Field label="Telephone" value={site.telephone ?? ''} onChangeText={(t) => setSite((p) => ({ ...p, telephone: t }))} />
      </SectionCard>

      <SectionCard title="Dispenser (LFD) identity">
        <Field label="Make" value={disp.make ?? ''} onChangeText={(t) => setDisp((p) => ({ ...p, make: t }))} />
        <Field label="Model" value={disp.model ?? ''} onChangeText={(t) => setDisp((p) => ({ ...p, model: t }))} />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label="Serial number" value={disp.serialNumber ?? ''} onChangeText={(t) => setDisp((p) => ({ ...p, serialNumber: t }))} />
          </View>
          <Button title="Scan" kind="secondary" onPress={() => setScanning(true)} />
        </View>
        <Field label="SA approval number" value={disp.saApprovalNumber ?? ''} onChangeText={(t) => setDisp((p) => ({ ...p, saApprovalNumber: t }))} />
      </SectionCard>

      <View style={{ marginHorizontal: 12 }}>
        <Button title="Save & continue to components" onPress={saveAndContinue} busy={busy} />
      </View>

      <BarcodeScannerModal
        visible={scanning}
        title="Scan the dispenser serial number"
        onClose={() => setScanning(false)}
        onScanned={(data) => {
          setScanning(false);
          setDisp((p) => ({ ...p, serialNumber: data }));
        }}
      />
    </FormScrollView>
  );
}

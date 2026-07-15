import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import type {
  Component,
  DispenserDetail,
  HoseDetail,
  HoseResult,
  Verification,
} from '@prowalco/schema';
import { SCHEMA_VERSION } from '@prowalco/schema';
import {
  getDispenser,
  getDispenserDetail,
  getSite,
  reserveCertificateNumber,
  saveDispenserDetail,
} from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { Button, SectionCard, colors, styles } from '../../../src/components/ui';
import { config } from '../../../src/config';
import {
  DELIVERY_NOMINAL_ML,
  METHOD_REFERENCE,
  REFERENCE_MEASURES,
  blankChecklist,
} from '../../../src/data/registers';
import * as repo from '../../../src/db/certificateRepo';

const COMPONENT_KEYS: (keyof HoseDetail['components'])[] = ['meter', 'pcBoard', 'pulsar', 'solenoid'];
const COMPONENT_LABELS: Record<string, string> = {
  meter: 'Meter',
  pcBoard: 'PC board',
  pulsar: 'Pulsar',
  solenoid: 'Solenoid',
};

const emptyComponent = (): Component => ({ make: '', model: '', serial: '', saApproval: '' });
const emptyHose = (n: number): HoseDetail => ({
  hoseNumber: String(n),
  product: 'ULP 95',
  securitySeal: '',
  components: {
    meter: emptyComponent(),
    pcBoard: emptyComponent(),
    pulsar: emptyComponent(),
    solenoid: emptyComponent(),
  },
});

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: 6,
  paddingHorizontal: 8,
  paddingVertical: 6,
  marginBottom: 5,
  color: colors.ink,
  backgroundColor: '#fff',
  fontSize: 13,
} as const;

export default function RegisterScreen() {
  const { id, workOrderId, siteId } = useLocalSearchParams<{
    id: string;
    workOrderId: string;
    siteId: string;
  }>();
  const router = useRouter();
  const { accessToken, identity } = useAuth();
  const [hoses, setHoses] = useState<HoseDetail[]>([]);
  const [qMin, setQMin] = useState('');
  const [qMax, setQMax] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const detail = await getDispenserDetail(accessToken, id);
        setHoses(detail.hoses.length ? (detail.hoses as HoseDetail[]) : [emptyHose(1)]);
        setQMin(detail.qMinLpm != null ? String(detail.qMinLpm) : '');
        setQMax(detail.qMaxLpm != null ? String(detail.qMaxLpm) : '');
      } catch {
        setHoses([emptyHose(1)]);
      } finally {
        setLoaded(true);
      }
    })();
  }, [accessToken, id]);

  if (!loaded) return <Text style={{ padding: 16 }}>Loading…</Text>;

  const updateHose = (i: number, patch: Partial<HoseDetail>) =>
    setHoses((prev) => prev.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const updateComponent = (i: number, key: keyof HoseDetail['components'], patch: Partial<Component>) =>
    setHoses((prev) =>
      prev.map((h, j) =>
        j === i ? { ...h, components: { ...h.components, [key]: { ...h.components[key], ...patch } } } : h,
      ),
    );

  const buildDeliveries = () =>
    (['del1_max', 'del2_max', 'del3_max', 'min_flow', 'preset'] as const).map((point) => {
      const nominal = DELIVERY_NOMINAL_ML[point];
      return { point, flowRateLpm: point === 'min_flow' ? 5 : 40, vfdMl: nominal, vrefMl: nominal, efdPercent: 0, pass: true };
    });

  const saveAndStart = async () => {
    for (const h of hoses) {
      if (!h.hoseNumber || !h.product) {
        Alert.alert('Hose incomplete', 'Each hose needs a hose/pump number and a product.');
        return;
      }
    }
    if (!identity) return;
    setBusy(true);
    try {
      const detail: Omit<DispenserDetail, 'dispenserId' | 'updatedAt'> = {
        qMinLpm: qMin ? Number(qMin) : undefined,
        qMaxLpm: qMax ? Number(qMax) : undefined,
        hoses,
      };
      await saveDispenserDetail(accessToken, id, detail);

      const [site, disp, certificateNumber] = await Promise.all([
        getSite(accessToken, siteId),
        getDispenser(accessToken, id),
        reserveCertificateNumber(accessToken, config.branchCode),
      ]);

      const hoseResults: HoseResult[] = hoses.map((h) => ({
        hoseNumber: h.hoseNumber,
        product: h.product,
        status: 'new',
        components: h.components,
        securitySeal: h.securitySeal || undefined,
        testCondition: 'cold',
        qMinLpm: qMin ? Number(qMin) : undefined,
        qMaxLpm: qMax ? Number(qMax) : undefined,
        checklist: blankChecklist(),
        deliveries: buildDeliveries(),
        outcome: 'certified',
      }));

      const verification: Partial<Verification> = {
        schemaVersion: SCHEMA_VERSION,
        certificateNumber,
        reportType: 'verification',
        site: {
          customerName: site.customerName,
          siteName: site.siteName,
          address: site.address,
          telephone: site.telephone ?? undefined,
        },
        jobReference: workOrderId,
        workOrderId,
        dispenser: {
          dispenserId: disp.id,
          makeModel: `${disp.make} ${disp.model}`.trim(),
          saApprovalNumber: disp.saApprovalNumber,
          serialNumber: disp.serialNumber,
        },
        referenceMeasures: REFERENCE_MEASURES,
        methodReference: METHOD_REFERENCE,
        hoses: hoseResults,
        signOff: {
          vo: { identity, pliersNumber: '' },
          client: { name: '' },
          declarationAccepted: false,
        },
        verificationDate: new Date().toISOString().slice(0, 10),
      };

      const draftId = repo.createDraft(certificateNumber, verification);
      router.push({ pathname: '/verification/[id]/results', params: { id: draftId } });
    } catch (err) {
      Alert.alert('Could not start verification', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <SectionCard title="Data plate">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 6 }}>
          Saved against this dispenser and prefilled next verification.
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>Qmin (L/min)</Text>
            <TextInput style={inputStyle} keyboardType="decimal-pad" value={qMin} onChangeText={setQMin} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>Qmax (L/min)</Text>
            <TextInput style={inputStyle} keyboardType="decimal-pad" value={qMax} onChangeText={setQMax} />
          </View>
        </View>
      </SectionCard>

      {hoses.map((h, i) => (
        <SectionCard key={i} title={`Hose / Pump ${h.hoseNumber || i + 1}`}>
          <Text style={{ fontSize: 12, color: colors.muted }}>Hose / Pump No.</Text>
          <TextInput style={inputStyle} value={h.hoseNumber} onChangeText={(t) => updateHose(i, { hoseNumber: t })} />
          <Text style={{ fontSize: 12, color: colors.muted }}>Product</Text>
          <TextInput style={inputStyle} value={h.product} onChangeText={(t) => updateHose(i, { product: t })} />
          <Text style={{ fontSize: 12, color: colors.muted }}>Security seal</Text>
          <TextInput style={inputStyle} value={h.securitySeal ?? ''} onChangeText={(t) => updateHose(i, { securitySeal: t })} />
          {COMPONENT_KEYS.map((key) => (
            <View key={key} style={{ marginTop: 6 }}>
              <Text style={{ fontWeight: '600', color: colors.ink, fontSize: 13 }}>{COMPONENT_LABELS[key]}</Text>
              {(['make', 'model', 'serial', 'saApproval'] as const).map((field) => (
                <TextInput
                  key={field}
                  style={inputStyle}
                  placeholder={field}
                  value={h.components[key][field] ?? ''}
                  onChangeText={(t) => updateComponent(i, key, { [field]: t })}
                />
              ))}
            </View>
          ))}
          {hoses.length > 1 ? (
            <Button title="Remove hose" kind="danger" onPress={() => setHoses((prev) => prev.filter((_, j) => j !== i))} />
          ) : null}
        </SectionCard>
      ))}

      <View style={{ marginHorizontal: 12 }}>
        <Button title="Add hose" kind="secondary" onPress={() => setHoses((prev) => [...prev, emptyHose(prev.length + 1)])} />
        <Button title="Save & start verification" onPress={saveAndStart} busy={busy} />
      </View>
    </ScrollView>
  );
}

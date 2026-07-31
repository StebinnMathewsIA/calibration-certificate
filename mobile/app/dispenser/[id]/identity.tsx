import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import type { DispenserDetail, HoseDetail } from '@prowalco/schema';
import {
  DispenserResolved,
  SiteResolved,
  editDispenser,
  getDispenser,
  getDispenserDetail,
  getSite,
  saveDispenserDetail,
  upsertSite,
} from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { BarcodeScannerModal } from '../../../src/components/BarcodeScanner';
import { Button, SectionCard, colors } from '../../../src/components/ui';
import { FormScrollView } from '../../../src/components/FormScrollView';
import { fetchThrough, writeCache } from '../../../src/db/cache';

const emptyHose = (n: number): HoseDetail => ({
  hoseNumber: String(n),
  product: '',
  securitySeal: '',
  components: { meter: {}, pcBoard: {}, pulsar: {}, solenoid: {} },
});

const hoseHasData = (h: HoseDetail): boolean =>
  Boolean(h.product || h.securitySeal) ||
  Object.values(h.components).some((c) => c.make || c.model || c.serial || c.saApproval);

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: 'decimal-pad' | 'number-pad';
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
        keyboardType={keyboardType}
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
  // Data plate + hoses are dispenser identity (#85), stored in the
  // per-dispenser register and prefilled every visit.
  const [detail, setDetail] = useState<DispenserDetail | null>(null);
  const [qMin, setQMin] = useState('');
  const [qMax, setQMax] = useState('');
  const [hoseCount, setHoseCount] = useState('');
  const [tacNumber, setTacNumber] = useState('');
  const [approvalBasis, setApprovalBasis] = useState<'SABS 1650' | 'LM R117' | null>(null);
  const [mmq, setMmq] = useState('');
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
      try {
        const det = await fetchThrough(`dispenser-detail:${id}`, () =>
          getDispenserDetail(accessToken, id),
        );
        setDetail(det as DispenserDetail);
        setQMin(det.qMinLpm != null ? String(det.qMinLpm) : '');
        setQMax(det.qMaxLpm != null ? String(det.qMaxLpm) : '');
        setTacNumber(det.tacNumber ?? '');
        setApprovalBasis(det.approvalBasis ?? null);
        setMmq(det.mmqLitres != null ? String(det.mmqLitres) : '');
        if (det.hoses.length > 0) setHoseCount(String(det.hoses.length));
      } catch {
        // First visit offline with no mirror: fields start blank.
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
    const count = Number(hoseCount);
    if (!Number.isInteger(count) || count < 1 || count > 16) {
      Alert.alert('Hoses required', 'Enter the number of hoses on this dispenser (1 to 16).');
      return;
    }
    // Resize the hose register, preserving anything already captured. A
    // shrink that would discard captured hose data needs confirmation.
    const existing = detail?.hoses ?? [];
    const dropped = existing.slice(count).filter(hoseHasData);
    if (dropped.length > 0) {
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'Remove hoses?',
          `Reducing to ${count} hose${count === 1 ? '' : 's'} discards captured details for hose${dropped.length === 1 ? '' : 's'} ${dropped.map((h) => h.hoseNumber).join(', ')}.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Remove', style: 'destructive', onPress: () => resolve(true) },
          ],
        );
      });
      if (!confirmed) return;
    }
    const hoses: HoseDetail[] = Array.from(
      { length: count },
      (_, i) => existing[i] ?? emptyHose(i + 1),
    );

    setBusy(true);
    try {
      // Persist to our canonical store (seed -> fill -> persist).
      await upsertSite(accessToken, siteId, {
        id: siteId,
        customerName: site.customerName!,
        siteName: site.siteName!,
        address: site.address!,
        telephone: site.telephone ?? undefined,
        contactPerson: site.contactPerson ?? undefined,
      });
      await editDispenser(accessToken, id, {
        make: disp.make!,
        model: disp.model!,
        serialNumber: disp.serialNumber!,
        saApprovalNumber: disp.saApprovalNumber!,
        siteId,
      });
      const nextDetail = {
        dispenserId: id,
        qMinLpm: qMin ? Number(qMin) : undefined,
        qMaxLpm: qMax ? Number(qMax) : undefined,
        tacNumber: tacNumber.trim() || undefined,
        approvalBasis: approvalBasis ?? undefined,
        mmqLitres: mmq ? Number(mmq) : undefined,
        hoses,
      };
      await saveDispenserDetail(accessToken, id, {
        qMinLpm: nextDetail.qMinLpm,
        qMaxLpm: nextDetail.qMaxLpm,
        tacNumber: nextDetail.tacNumber,
        approvalBasis: nextDetail.approvalBasis,
        mmqLitres: nextDetail.mmqLitres,
        hoses,
      });
      // The components screen reads through the mirror: reflect the resize
      // there immediately, whether or not the server write reached it.
      writeCache(`dispenser-detail:${id}`, nextDetail);
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
        <Field
          label="Contact person on premises"
          value={site.contactPerson ?? ''}
          onChangeText={(t) => setSite((p) => ({ ...p, contactPerson: t }))}
        />
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

      <SectionCard title="Data plate & hoses">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>
          From the dispenser's data plate. Saved against this dispenser and prefilled every
          verification. The hose entries are created below the count you set here.
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label="Qmin (L/min)" value={qMin} onChangeText={setQMin} keyboardType="decimal-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Qmax (L/min)" value={qMax} onChangeText={setQMax} keyboardType="decimal-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Number of hoses" value={hoseCount} onChangeText={setHoseCount} keyboardType="number-pad" />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 2 }}>
            <Field label="TAC number" value={tacNumber} onChangeText={setTacNumber} placeholder="S.A. …" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="MMQ (litres)" value={mmq} onChangeText={setMmq} keyboardType="decimal-pad" />
          </View>
        </View>
        <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>Approval basis</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {(['SABS 1650', 'LM R117'] as const).map((b) => {
            const on = approvalBasis === b;
            return (
              <Text
                key={b}
                onPress={() => setApprovalBasis(on ? null : b)}
                accessibilityRole="button"
                accessibilityLabel={`${on ? 'Clear approval basis' : `Set approval basis ${b}`}`}
                style={{
                  borderWidth: 1,
                  borderColor: on ? colors.blueText : colors.line,
                  backgroundColor: on ? colors.blueTint : '#fff',
                  color: on ? colors.blueText : colors.ink,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  overflow: 'hidden',
                  fontSize: 13,
                }}
              >
                {b}
              </Text>
            );
          })}
        </View>
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

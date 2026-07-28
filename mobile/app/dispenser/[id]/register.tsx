import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import type {
  Component,
  Delivery,
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
import { Button, SectionCard, colors } from '../../../src/components/ui';
import { FormScrollView } from '../../../src/components/FormScrollView';
import { config } from '../../../src/config';
import { fetchThrough } from '../../../src/db/cache';
import { DELIVERY_NOMINAL_ML, METHOD_REFERENCE, PRODUCT_OPTIONS } from '../../../src/data/registers';
import { getProfile } from '../../../src/profile/profileStore';
import * as repo from '../../../src/db/certificateRepo';

const COMPONENT_KEYS: (keyof HoseDetail['components'])[] = ['meter', 'pcBoard', 'pulsar', 'solenoid'];
const COMPONENT_LABELS: Record<string, string> = {
  meter: 'Meter',
  pcBoard: 'PC board',
  pulsar: 'Pulsar',
  solenoid: 'Solenoid',
};

// Field labels match the NRCS certificate column headers.
const FIELD_KEYS = ['make', 'model', 'serial', 'saApproval'] as const;
const FIELD_LABELS: Record<(typeof FIELD_KEYS)[number], string> = {
  make: 'Make',
  model: 'Model',
  serial: 'Serial No.',
  saApproval: 'SA Approval no.',
};

const emptyComponent = (): Component => ({ make: '', model: '', serial: '', saApproval: '' });
// A new hose carries NO assumptions (#78): the VO records the product that
// is actually on the forecourt. Saved hoses prefill from the register.
const emptyHose = (n: number): HoseDetail => ({
  hoseNumber: String(n),
  product: '',
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
  borderRadius: 10,
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
  // Which hoses THIS verification covers (#85): all by default, tap to
  // unselect the ones not being verified today.
  const [selected, setSelected] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const detail = await fetchThrough(`dispenser-detail:${id}`, () =>
          getDispenserDetail(accessToken, id),
        );
        const hs = detail.hoses.length ? (detail.hoses as HoseDetail[]) : [emptyHose(1)];
        setHoses(hs);
        setSelected(hs.map(() => true));
        setQMin(detail.qMinLpm != null ? String(detail.qMinLpm) : '');
        setQMax(detail.qMaxLpm != null ? String(detail.qMaxLpm) : '');
      } catch {
        setHoses([emptyHose(1)]);
        setSelected([true]);
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

  // VFD is the fixed nominal the dispenser delivers (20 L / 5 L), so we
  // pre-fill it. Flow and VREF are the VO's on-site readings — left blank.
  const buildDeliveries = () =>
    (['del1_max', 'del2_max', 'del3_max', 'min_flow', 'preset'] as const).map(
      (point) =>
        ({
          point,
          flowRateLpm: undefined,
          vfdMl: DELIVERY_NOMINAL_ML[point],
          vrefMl: undefined,
          efdPercent: undefined,
          pass: false,
        }) as unknown as Delivery,
    );

  const saveAndStart = async () => {
    const verifying = hoses.filter((_, i) => selected[i]);
    if (verifying.length === 0) {
      Alert.alert('No hoses selected', 'Select at least one hose to verify.');
      return;
    }
    for (const h of verifying) {
      if (!h.hoseNumber || !h.product) {
        Alert.alert(
          'Hose incomplete',
          `Hose ${h.hoseNumber || '?'}: every hose being verified needs a hose/pump number and a product.`,
        );
        return;
      }
    }
    if (!identity) return;

    // Certified-measures gate (#70): no verification starts without all
    // three measures registered and in date. Mirrored locally, so the gate
    // works offline.
    const activeMeasures = getProfile(identity.subject).measures ?? [];
    const today = new Date().toISOString().slice(0, 10);
    const missing = ['200L', '20L', '5L'].filter(
      (s) => !activeMeasures.some((m) => m.size === s),
    );
    const expired = activeMeasures.filter((m) => m.expiryDate < today);
    if (missing.length > 0 || expired.length > 0) {
      const problems = [
        ...missing.map((s) => `• ${s} measure not registered`),
        ...expired.map((m) => `• ${m.size} measure ${m.serialNumber} expired ${m.expiryDate}`),
      ].join('\n');
      Alert.alert(
        'Certified measures required',
        `A verification cannot start until your proving measures are certified and in date:\n\n${problems}\n\nRegister them in your profile.`,
      );
      return;
    }

    setBusy(true);
    try {
      const detail: Omit<DispenserDetail, 'dispenserId' | 'updatedAt'> = {
        qMinLpm: qMin ? Number(qMin) : undefined,
        qMaxLpm: qMax ? Number(qMax) : undefined,
        hoses,
      };
      // Offline the canonical-store save fails but must not block the
      // verification: the components are snapshotted into the payload below,
      // and the store catches up on the next online visit.
      try {
        await saveDispenserDetail(accessToken, id, detail);
      } catch {
        // continue — offline
      }

      // Site/dispenser identity read through the offline cache (populated
      // when the work order was opened online).
      const [site, disp] = await Promise.all([
        fetchThrough(`site:${siteId}`, () => getSite(accessToken, siteId)),
        fetchThrough(`dispenser:${id}`, () => getDispenser(accessToken, id)),
      ]);

      // Number reservation is server-side; offline the draft starts
      // numberless and backfillCertificateNumbers() assigns it on reconnect.
      let certificateNumber: string | null = null;
      try {
        certificateNumber = await reserveCertificateNumber(accessToken, config.branchCode);
      } catch {
        Alert.alert(
          'Working offline',
          'A certificate number will be assigned automatically when the device is back online. You can complete the whole verification now.',
        );
      }

      // Identity/components carry over (known data); everything the VO
      // determines on-site starts UNSET so nothing reads as a result until
      // they enter it: status, hot/cold, the checklist, and the deliveries.
      // Only the SELECTED hoses are verified and appear on the certificate.
      const hoseResults = verifying.map((h) => ({
        hoseNumber: h.hoseNumber,
        product: h.product,
        status: undefined,
        components: h.components,
        securitySeal: h.securitySeal || undefined,
        testCondition: undefined,
        qMinLpm: qMin ? Number(qMin) : undefined,
        qMaxLpm: qMax ? Number(qMax) : undefined,
        checklist: {},
        deliveries: buildDeliveries(),
        outcome: 'certified',
      })) as unknown as HoseResult[];

      const verification: Partial<Verification> = {
        schemaVersion: SCHEMA_VERSION,
        certificateNumber: certificateNumber ?? undefined,
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
        // The VO's ACTIVE certified measures (#70) — the gate above
        // guarantees all three sizes exist and are in date.
        referenceMeasures: activeMeasures.map((m) => ({
          size: m.size,
          serialNumber: m.serialNumber,
          certificateNumber: m.certificateNumber,
          calibrationDate: m.calibrationDate,
          expiryDate: m.expiryDate,
        })) as unknown as Verification['referenceMeasures'],
        methodReference: METHOD_REFERENCE,
        hoses: hoseResults,
        signOff: {
          vo: { identity, pliersNumber: '' },
          client: { name: '' },
          declarationAccepted: false,
        },
        verificationDate: new Date().toISOString().slice(0, 10),
      };

      const draftId = repo.createDraft(certificateNumber ?? null, verification);
      router.push({ pathname: '/verification/[id]/results', params: { id: draftId } });
    } catch (err) {
      Alert.alert('Could not start verification', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormScrollView>
      <SectionCard title="Hoses to verify">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 6 }}>
          All hoses are selected. Tap a hose to leave it out of this verification, e.g. when a
          hose is in use. Only selected hoses appear on the certificate. The data plate and the
          number of hoses are set on the dispenser identity screen.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {hoses.map((h, i) => {
            const on = selected[i] ?? true;
            return (
              <Text
                key={i}
                onPress={() =>
                  setSelected((prev) => prev.map((s, j) => (j === i ? !s : s)))
                }
                accessibilityRole="button"
                accessibilityLabel={`${on ? 'Exclude' : 'Include'} hose ${h.hoseNumber || i + 1}`}
                style={{
                  borderWidth: 1,
                  borderColor: on ? colors.greenText : colors.line,
                  backgroundColor: on ? colors.greenTint : '#fff',
                  color: on ? colors.greenText : colors.muted,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  overflow: 'hidden',
                  fontSize: 13,
                  fontWeight: '600',
                }}
              >
                Hose {h.hoseNumber || i + 1}{on ? ' ✓' : ''}
              </Text>
            );
          })}
        </View>
      </SectionCard>

      {hoses.map((h, i) => (
        <SectionCard
          key={i}
          title={`Hose / Pump ${h.hoseNumber || i + 1}${selected[i] ?? true ? '' : ' · not in this verification'}`}
        >
          <Text style={{ fontSize: 12, color: colors.muted }}>Hose / Pump No.</Text>
          <TextInput style={inputStyle} value={h.hoseNumber} onChangeText={(t) => updateHose(i, { hoseNumber: t })} />
          <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>Product</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            {/* Legacy register values outside the standard list stay
                selectable so nothing already captured is orphaned (#86). */}
            {[...PRODUCT_OPTIONS, ...(h.product && !PRODUCT_OPTIONS.includes(h.product) ? [h.product] : [])].map(
              (p) => {
                const on = h.product === p;
                return (
                  <Text
                    key={p}
                    onPress={() => updateHose(i, { product: on ? '' : p })}
                    accessibilityRole="button"
                    accessibilityLabel={`${on ? 'Clear product' : `Set product to ${p}`} for hose ${h.hoseNumber || i + 1}`}
                    style={{
                      borderWidth: 1,
                      borderColor: on ? colors.blueText : colors.line,
                      backgroundColor: on ? colors.blueTint : '#fff',
                      color: on ? colors.blueText : colors.ink,
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 999,
                      overflow: 'hidden',
                      fontSize: 12,
                    }}
                  >
                    {p}
                  </Text>
                );
              },
            )}
          </View>
          <Text style={{ fontSize: 12, color: colors.muted }}>Security seal</Text>
          <TextInput style={inputStyle} value={h.securitySeal ?? ''} onChangeText={(t) => updateHose(i, { securitySeal: t })} />
          {COMPONENT_KEYS.map((key) => (
            <View key={key} style={{ marginTop: 8 }}>
              <Text style={{ fontWeight: '700', color: colors.ink, fontSize: 13, marginBottom: 2 }}>
                {COMPONENT_LABELS[key]}
              </Text>
              {FIELD_KEYS.map((field) => (
                <View key={field} style={{ marginBottom: 4 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{FIELD_LABELS[field]}</Text>
                  <TextInput
                    style={inputStyle}
                    placeholder={FIELD_LABELS[field]}
                    value={h.components[key][field] ?? ''}
                    onChangeText={(t) => updateComponent(i, key, { [field]: t })}
                  />
                </View>
              ))}
            </View>
          ))}
        </SectionCard>
      ))}

      <View style={{ marginHorizontal: 12 }}>
        <Button title="Save & start verification" onPress={saveAndStart} busy={busy} />
      </View>
    </FormScrollView>
  );
}

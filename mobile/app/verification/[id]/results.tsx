import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import type { Checklist, Delivery, HoseResult, Verification } from '@prowalco/schema';
import { CHECKLIST_ITEMS, DELIVERY_POINT_LABELS, computeEfd } from '@prowalco/schema';
import { Badge, Button, SectionCard, colors, styles } from '../../../src/components/ui';
import * as repo from '../../../src/db/certificateRepo';

const numInput = {
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: 6,
  paddingHorizontal: 8,
  paddingVertical: 6,
  color: colors.ink,
  backgroundColor: '#fff',
  fontSize: 13,
} as const;

/** Show an empty field (not "0"/"undefined") until the VO enters a value. */
const numStr = (v?: number) => (v == null || Number.isNaN(v) ? '' : String(v));
const parseNum = (t: string): number | undefined => (t.trim() === '' ? undefined : Number(t));

function Pill({ label, active, tone, onPress }: { label: string; active: boolean; tone: string; onPress: () => void }) {
  return (
    <Text
      onPress={onPress}
      style={{
        borderWidth: 1,
        borderColor: active ? tone : colors.line,
        backgroundColor: active ? tone : '#fff',
        color: active ? '#fff' : colors.ink,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 14,
        overflow: 'hidden',
        fontSize: 12,
        marginRight: 6,
      }}
    >
      {label}
    </Text>
  );
}

export default function ResultsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const record = useMemo(() => repo.getById(id), [id]);
  const [v, setV] = useState<Partial<Verification> | null>(record?.form ?? null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Debounced autosave.
  useEffect(() => {
    if (!v) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => repo.saveDraftForm(id, v), 700);
    return () => clearTimeout(timer.current);
  }, [v, id]);

  if (!record || !v || !v.hoses) return <Text style={{ padding: 16 }}>Not found</Text>;

  const setHose = (hi: number, patch: Partial<HoseResult>) =>
    setV((prev) => {
      if (!prev?.hoses) return prev;
      const hoses = prev.hoses.map((h, i) => (i === hi ? { ...h, ...patch } : h));
      return { ...prev, hoses };
    });

  const setChecklist = (hi: number, key: keyof Checklist, value: 'pass' | 'fail' | 'na') =>
    setV((prev) => {
      if (!prev?.hoses) return prev;
      const hoses = prev.hoses.map((h, i) =>
        i === hi ? { ...h, checklist: { ...h.checklist, [key]: value } } : h,
      );
      return { ...prev, hoses };
    });

  const setDelivery = (hi: number, di: number, patch: Partial<Delivery>) =>
    setV((prev) => {
      if (!prev?.hoses) return prev;
      const hoses = prev.hoses.map((h, i) => {
        if (i !== hi) return h;
        const deliveries = h.deliveries.map((d, j) => {
          if (j !== di) return d;
          const merged = { ...d, ...patch } as Delivery;
          // EFD is only meaningful once both readings are present.
          if ((merged.vrefMl ?? 0) > 0 && (merged.vfdMl ?? 0) > 0) {
            const c = computeEfd(merged.vfdMl, merged.vrefMl);
            merged.efdPercent = c.efdPercent;
            merged.pass = c.pass;
          } else {
            merged.efdPercent = undefined as unknown as number;
            merged.pass = false;
          }
          return merged;
        });
        return { ...h, deliveries };
      });
      return { ...prev, hoses };
    });

  const continueToSign = () => {
    // Every result must be entered before moving on — nothing is pre-judged.
    const hoses = v.hoses as HoseResult[];
    for (let i = 0; i < hoses.length; i++) {
      const h = hoses[i];
      const label = `Hose ${h.hoseNumber}`;
      if (!h.status) return complain(`${label}: choose a verification status.`);
      if (!h.testCondition) return complain(`${label}: choose hot or cold.`);
      const missingCheck = CHECKLIST_ITEMS.find((it) => !h.checklist[it.key]);
      if (missingCheck) return complain(`${label}: complete the checklist ("${missingCheck.label}").`);
      const bad = h.deliveries.find(
        (d) => !((d.flowRateLpm ?? 0) > 0 && (d.vfdMl ?? 0) > 0 && (d.vrefMl ?? 0) > 0),
      );
      if (bad) return complain(`${label}: enter Flow, VFD and VREF for every delivery.`);
    }

    // Outcome follows the evidence (a failed check or delivery => rejected).
    const withOutcomes: Verification = {
      ...(v as Verification),
      hoses: hoses.map((h) => {
        const anyFail =
          h.deliveries.some((d) => !d.pass) || Object.values(h.checklist).some((x) => x === 'fail');
        return { ...h, outcome: anyFail ? 'rejected' : 'certified' };
      }),
    };
    repo.saveDraftForm(id, withOutcomes);
    router.push({ pathname: '/verification/[id]/sign', params: { id } });
  };

  const complain = (msg: string) => {
    Alert.alert('Results incomplete', msg);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets>
      <SectionCard title={`Certificate ${v.certificateNumber ?? ''}`}>
        <Text style={{ color: colors.muted, fontSize: 13 }}>
          {v.site?.customerName} · {v.site?.siteName} · {v.dispenser?.serialNumber}
        </Text>
      </SectionCard>

      {(v.hoses as HoseResult[]).map((hose, hi) => (
        <SectionCard key={hi} title={`Hose / Pump ${hose.hoseNumber} — ${hose.product}`}>
          <Text style={{ fontSize: 12, color: colors.muted }}>Verification status</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginVertical: 6 }}>
            {(['new', 'repaired', 'atu', 'rejected'] as const).map((s) => (
              <Pill key={s} label={s} active={hose.status === s} tone={colors.blue} onPress={() => setHose(hi, { status: s })} />
            ))}
          </View>
          <Text style={{ fontSize: 12, color: colors.muted }}>Test condition</Text>
          <View style={{ flexDirection: 'row', marginVertical: 6 }}>
            {(['hot', 'cold'] as const).map((c) => (
              <Pill key={c} label={c} active={hose.testCondition === c} tone={colors.blue} onPress={() => setHose(hi, { testCondition: c })} />
            ))}
          </View>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
            {(['totalizerBefore', 'totalizerAfter', 'quantityDelivered'] as const).map((k) => (
              <View key={k} style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, color: colors.muted }}>{k}</Text>
                <TextInput
                  style={numInput}
                  keyboardType="decimal-pad"
                  value={hose[k] != null ? String(hose[k]) : ''}
                  onChangeText={(t) => setHose(hi, { [k]: t === '' ? undefined : Number(t) } as Partial<HoseResult>)}
                />
              </View>
            ))}
          </View>

          <Text style={{ fontWeight: '700', color: colors.ink, marginTop: 10 }}>Checklist</Text>
          {CHECKLIST_ITEMS.map((item) => (
            <View key={item.key} style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 2 }}>
              <Text style={{ flex: 1, fontSize: 12, color: colors.ink }}>{item.label}</Text>
              {(['pass', 'fail', 'na'] as const).map((val) => (
                <Pill
                  key={val}
                  label={val.toUpperCase()}
                  active={hose.checklist[item.key] === val}
                  tone={val === 'fail' ? colors.red : val === 'pass' ? colors.green : colors.muted}
                  onPress={() => setChecklist(hi, item.key, val)}
                />
              ))}
            </View>
          ))}

          <Text style={{ fontWeight: '700', color: colors.ink, marginTop: 10 }}>
            EFD deliveries (VFD vs VREF, mL)
          </Text>
          {hose.deliveries.map((d, di) => (
            <View key={di} style={{ borderTopWidth: 1, borderColor: colors.line, paddingVertical: 6 }}>
              <Text style={{ fontSize: 12, color: colors.ink }}>{DELIVERY_POINT_LABELS[d.point]}</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>Flow L/min</Text>
                  <TextInput style={numInput} keyboardType="decimal-pad" placeholder="—" value={numStr(d.flowRateLpm)} onChangeText={(t) => setDelivery(hi, di, { flowRateLpm: parseNum(t) })} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>VFD</Text>
                  <TextInput style={numInput} keyboardType="decimal-pad" placeholder="—" value={numStr(d.vfdMl)} onChangeText={(t) => setDelivery(hi, di, { vfdMl: parseNum(t) })} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>VREF</Text>
                  <TextInput style={numInput} keyboardType="decimal-pad" placeholder="—" value={numStr(d.vrefMl)} onChangeText={(t) => setDelivery(hi, di, { vrefMl: parseNum(t) })} />
                </View>
                <View style={{ width: 84, alignItems: 'center', justifyContent: 'flex-end' }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>EFD</Text>
                  <Badge
                    text={d.efdPercent == null ? '—' : `${d.efdPercent.toFixed(2)}% ${d.pass ? '✓' : '✗'}`}
                    tone={d.efdPercent == null ? 'muted' : d.pass ? 'ok' : 'bad'}
                  />
                </View>
              </View>
            </View>
          ))}
        </SectionCard>
      ))}

      <View style={{ marginHorizontal: 12 }}>
        <Button title="Continue to sign" onPress={continueToSign} />
      </View>
    </ScrollView>
  );
}

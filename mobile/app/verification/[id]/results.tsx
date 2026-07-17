import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import type { Checklist, Delivery, HoseResult, Verification } from '@prowalco/schema';
import { CHECKLIST_ITEMS, DELIVERY_POINT_LABELS, MPE_PERCENT, computeEfd } from '@prowalco/schema';
import { Badge, Button, SectionCard, colors, fonts } from '../../../src/components/ui';
import { FormScrollView } from '../../../src/components/FormScrollView';
import * as repo from '../../../src/db/certificateRepo';

// Glove-friendly: the delivery grid is the highest-frequency entry surface.
// Numeric readouts wear Roboto Mono with tabular figures (brand rule 7).
const numInput: import('react-native').TextStyle = {
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: 10,
  paddingHorizontal: 8,
  paddingVertical: 10,
  minHeight: 44,
  color: colors.ink,
  backgroundColor: '#fff',
  fontSize: 16,
  fontFamily: fonts.mono,
  fontVariant: ['tabular-nums', 'lining-nums'],
};

/** How much of the ±MPE band a delivery uses, as a colour-graded bar. */
function ToleranceBar({ efdPercent }: { efdPercent: number }) {
  const usage = Math.abs(efdPercent) / MPE_PERCENT;
  // Status colours only — brand green never means "pass" (brand rule 6).
  const color = usage >= 1 ? colors.redFill : usage >= 0.75 ? colors.amberFill : colors.greenText;
  return (
    <View style={{ marginTop: 6 }}>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' }}>
        <View style={{ width: `${Math.min(usage, 1) * 100}%`, height: 6, backgroundColor: color }} />
      </View>
      <Text
        style={{
          color: colors.muted,
          fontSize: 11,
          marginTop: 2,
          fontFamily: fonts.mono,
          fontVariant: ['tabular-nums', 'lining-nums'],
        }}
      >
        {Math.round(usage * 100)}% of the ±{MPE_PERCENT} % MPE used
      </Text>
    </View>
  );
}

/** What the VO still has to enter on a hose, for the inline completeness
 * line (previously only the first gap surfaced, via Alert, on Continue). */
function hoseMissing(h: HoseResult): string[] {
  const missing: string[] = [];
  if (!h.status) missing.push('verification status');
  if (!h.testCondition) missing.push('test condition');
  const unanswered = CHECKLIST_ITEMS.filter((it) => !h.checklist[it.key]).length;
  if (unanswered) missing.push(`${unanswered} checklist item${unanswered === 1 ? '' : 's'}`);
  const dels = h.deliveries.filter(
    (d) => !((d.flowRateLpm ?? 0) > 0 && (d.vfdMl ?? 0) > 0 && (d.vrefMl ?? 0) > 0),
  ).length;
  if (dels) missing.push(`${dels} deliver${dels === 1 ? 'y' : 'ies'}`);
  return missing;
}

const DELIVERY_FIELDS = ['flowRateLpm', 'vfdMl', 'vrefMl'] as const;

/** Show an empty field (not "0"/"undefined") until the VO enters a value. */
const numStr = (v?: number) => (v == null || Number.isNaN(v) ? '' : String(v));
const parseNum = (t: string): number | undefined => (t.trim() === '' ? undefined : Number(t));

/** Selectable pill following the brand chip recipe: active = tinted
 * background + dark status/semantic text (never white on a bright fill). */
const PILL_TONES = {
  info: { bg: colors.blueTint, fg: colors.blueText },
  ok: { bg: colors.greenTint, fg: colors.greenText },
  bad: { bg: colors.redTint, fg: colors.red },
  muted: { bg: colors.mist, fg: colors.muted },
} as const;

function Pill({
  label,
  active,
  tone,
  onPress,
}: {
  label: string;
  active: boolean;
  tone: keyof typeof PILL_TONES;
  onPress: () => void;
}) {
  const c = PILL_TONES[tone];
  return (
    <Text
      onPress={onPress}
      style={{
        borderWidth: 1,
        borderColor: active ? c.fg : colors.line,
        backgroundColor: active ? c.bg : '#fff',
        color: active ? c.fg : colors.ink,
        fontFamily: active ? fonts.bodyMedium : fonts.body,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
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
  // Keyboard "next" chain across the delivery grid: flow → VFD → VREF → next
  // delivery's flow, keyed `${hose}.${delivery}.${field}`.
  const inputs = useRef<Record<string, TextInput | null>>({});

  const focusNext = (hi: number, di: number, field: (typeof DELIVERY_FIELDS)[number]) => {
    const at = DELIVERY_FIELDS.indexOf(field);
    const key =
      at < DELIVERY_FIELDS.length - 1
        ? `${hi}.${di}.${DELIVERY_FIELDS[at + 1]}`
        : `${hi}.${di + 1}.${DELIVERY_FIELDS[0]}`;
    inputs.current[key]?.focus();
  };

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
    <FormScrollView>
      <SectionCard title={`Certificate ${v.certificateNumber ?? '(number pending — assigns when online)'}`}>
        <Text style={{ color: colors.muted, fontSize: 13 }}>
          {v.site?.customerName} · {v.site?.siteName} · {v.dispenser?.serialNumber}
        </Text>
      </SectionCard>

      {(v.hoses as HoseResult[]).map((hose, hi) => {
        const missing = hoseMissing(hose);
        return (
        <SectionCard key={hi} title={`Hose / Pump ${hose.hoseNumber} — ${hose.product}`}>
          {missing.length === 0 ? (
            <View style={{ marginBottom: 6 }}>
              <Badge text="All results entered ✓" tone="ok" />
            </View>
          ) : (
            <Text style={{ color: colors.amber, fontSize: 12, marginBottom: 6 }}>
              Still to enter: {missing.join(', ')}
            </Text>
          )}
          <Text style={{ fontSize: 12, color: colors.muted }}>Verification status</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginVertical: 6 }}>
            {(['new', 'repaired', 'atu', 'rejected'] as const).map((s) => (
              <Pill
                key={s}
                label={s === 'atu' ? 'ATU' : s[0].toUpperCase() + s.slice(1)}
                active={hose.status === s}
                tone="info"
                onPress={() => setHose(hi, { status: s })}
              />
            ))}
          </View>
          <Text style={{ fontSize: 12, color: colors.muted }}>Test condition</Text>
          <View style={{ flexDirection: 'row', marginVertical: 6 }}>
            {(['hot', 'cold'] as const).map((c) => (
              <Pill
                key={c}
                label={c[0].toUpperCase() + c.slice(1)}
                active={hose.testCondition === c}
                tone="info"
                onPress={() => setHose(hi, { testCondition: c })}
              />
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
              <Text
                style={{
                  flex: 1,
                  fontSize: 12,
                  color: hose.checklist[item.key] ? colors.ink : colors.amber,
                }}
              >
                {hose.checklist[item.key] ? '' : '• '}
                {item.label}
              </Text>
              {(['pass', 'fail', 'na'] as const).map((val) => (
                <Pill
                  key={val}
                  label={val === 'na' ? 'N/A' : val[0].toUpperCase() + val.slice(1)}
                  active={hose.checklist[item.key] === val}
                  tone={val === 'fail' ? 'bad' : val === 'pass' ? 'ok' : 'muted'}
                  onPress={() => setChecklist(hi, item.key, val)}
                />
              ))}
            </View>
          ))}

          <Text style={{ fontWeight: '700', color: colors.ink, marginTop: 10 }}>
            EFD deliveries (VFD vs VREF, mL)
          </Text>
          {hose.deliveries.map((d, di) => {
            const isLastDelivery = di === hose.deliveries.length - 1;
            const FIELD_META: Record<(typeof DELIVERY_FIELDS)[number], { label: string; value?: number }> = {
              flowRateLpm: { label: 'Flow L/min', value: d.flowRateLpm },
              vfdMl: { label: 'VFD', value: d.vfdMl },
              vrefMl: { label: 'VREF', value: d.vrefMl },
            };
            return (
            <View key={di} style={{ borderTopWidth: 1, borderColor: colors.line, paddingVertical: 6 }}>
              <Text style={{ fontSize: 12, color: colors.ink }}>{DELIVERY_POINT_LABELS[d.point]}</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                {DELIVERY_FIELDS.map((field, fi) => (
                  <View key={field} style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{FIELD_META[field].label}</Text>
                    <TextInput
                      ref={(r) => {
                        inputs.current[`${hi}.${di}.${field}`] = r;
                      }}
                      style={numInput}
                      keyboardType="decimal-pad"
                      placeholder="—"
                      value={numStr(FIELD_META[field].value)}
                      onChangeText={(t) => setDelivery(hi, di, { [field]: parseNum(t) } as Partial<Delivery>)}
                      returnKeyType={isLastDelivery && fi === DELIVERY_FIELDS.length - 1 ? 'done' : 'next'}
                      blurOnSubmit={isLastDelivery && fi === DELIVERY_FIELDS.length - 1}
                      onSubmitEditing={() => focusNext(hi, di, field)}
                    />
                  </View>
                ))}
                <View style={{ width: 84, alignItems: 'center', justifyContent: 'flex-end' }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>EFD</Text>
                  <Badge
                    text={d.efdPercent == null ? '—' : `${d.efdPercent.toFixed(2)}% ${d.pass ? '✓' : '✗'}`}
                    tone={d.efdPercent == null ? 'muted' : d.pass ? 'ok' : 'bad'}
                    mono={d.efdPercent != null}
                  />
                </View>
              </View>
              {d.efdPercent != null && !Number.isNaN(d.efdPercent) ? (
                <ToleranceBar efdPercent={d.efdPercent} />
              ) : null}
            </View>
            );
          })}
        </SectionCard>
        );
      })}

      <View style={{ marginHorizontal: 12 }}>
        <Button title="Continue to sign" onPress={continueToSign} />
      </View>
    </FormScrollView>
  );
}

import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import type { Checklist, Delivery, HoseResult, Verification } from '@prowalco/schema';
import {
  CHECKLIST_ITEMS,
  DELIVERY_POINT_LABELS,
  MPE_PERCENT,
  NOZZLE_BURST_LIMIT_ML,
  computeEfd,
  testPlanFor,
} from '@prowalco/schema';
import { discardCertificate } from '../../../src/certs/discard';
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
  if (!((h.unitPrice ?? 0) > 0)) missing.push('unit price');
  const unanswered = CHECKLIST_ITEMS.filter((it) => !h.checklist[it.key]).length;
  if (unanswered) missing.push(`${unanswered} checklist item${unanswered === 1 ? '' : 's'}`);
  const dels = h.deliveries.filter(
    (d) => !((d.flowRateLpm ?? 0) > 0 && (d.vfdMl ?? 0) > 0 && (d.vrefMl ?? 0) > 0),
  ).length;
  if (dels) missing.push(`${dels} deliver${dels === 1 ? 'y' : 'ies'}`);
  return missing;
}

// VFD is FIXED per delivery point (#87) — only Flow and VREF are entered.
const DELIVERY_FIELDS = ['flowRateLpm', 'vrefMl'] as const;

/** Show an empty field (not "0"/"undefined") until the VO enters a value. */
const numStr = (v?: number) => (v == null || Number.isNaN(v) ? '' : String(v));
const parseNum = (t: string): number | undefined => (t.trim() === '' ? undefined : Number(t));

/** Advisory flow-rate window check (#90): max-flow deliveries belong at 50
 * to 100 % of Qmax, minimum-flow deliveries at 100 to 120 % of Qmin (both
 * from the TAC / data plate). Null when in window or unknowable. */
function flowWindowWarning(h: HoseResult, d: Delivery): string | null {
  const f = d.flowRateLpm;
  if (!f || f <= 0) return null;
  if (d.point === 'del1_max' || d.point === 'del2_max' || d.point === 'del3_max') {
    const qmax = h.qMaxLpm;
    if (qmax && (f < 0.5 * qmax || f > qmax)) {
      return `Flow ${f} L/min is outside 50 to 100% of Qmax (${qmax} L/min)`;
    }
  } else if (d.point === 'min_flow' || d.point === 'min_flow_20l') {
    const qmin = h.qMinLpm;
    if (qmin && (f < qmin || f > 1.2 * qmin)) {
      return `Flow ${f} L/min is outside 100 to 120% of Qmin (${qmin} L/min)`;
    }
  }
  return null;
}

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
  // Collapsible hoses (#85): on a multi-hose pump the VO jumps straight to
  // whichever hose is free. A single hose starts open.
  const [open, setOpen] = useState<Record<number, boolean>>(() =>
    (record?.form?.hoses?.length ?? 0) === 1 ? { 0: true } : ({} as Record<number, boolean>),
  );
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

  // Normalize drafts to the FIXED VFD nominals of the draft's PINNED plan
  // (#87/#92): drafts started before the preset correction carry 20 L
  // there; EFD recomputes where VREF exists.
  useEffect(() => {
    setV((prev) => {
      if (!prev?.hoses) return prev;
      const nominals = Object.fromEntries(
        testPlanFor(prev).deliveries.map((pd) => [pd.point, pd.nominalMl]),
      );
      let changed = false;
      const hoses = prev.hoses.map((h) => {
        const deliveries = h.deliveries.map((d) => {
          const nominal = nominals[d.point];
          if (nominal == null) return d;
          if (d.vfdMl === nominal) return d;
          changed = true;
          const merged = { ...d, vfdMl: nominal } as Delivery;
          if ((merged.vrefMl ?? 0) > 0) {
            const c = computeEfd(merged.vfdMl, merged.vrefMl);
            merged.efdPercent = c.efdPercent;
            merged.pass = c.pass;
          }
          return merged;
        });
        return { ...h, deliveries };
      });
      return changed ? { ...prev, hoses } : prev;
    });
  }, []);

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
      if (!h.status) return complain(`${label}: choose a verification status.`, i);
      if (!h.testCondition) return complain(`${label}: choose hot or cold.`, i);
      if (!((h.unitPrice ?? 0) > 0))
        return complain(`${label}: enter the unit price (R/L).`, i);
      const missingCheck = CHECKLIST_ITEMS.find((it) => !h.checklist[it.key]);
      if (missingCheck)
        return complain(`${label}: complete the checklist ("${missingCheck.label}").`, i);
      const bad = h.deliveries.find(
        (d) => !((d.flowRateLpm ?? 0) > 0 && (d.vfdMl ?? 0) > 0 && (d.vrefMl ?? 0) > 0),
      );
      if (bad) return complain(`${label}: enter Flow, VFD and VREF for every delivery.`, i);
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

  const complain = (msg: string, hoseIndex?: number) => {
    // Expand the offending hose so the VO lands on the gap.
    if (hoseIndex != null) setOpen((prev) => ({ ...prev, [hoseIndex]: true }));
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
        const isOpen = open[hi] ?? false;
        return (
        <SectionCard
          key={hi}
          title={`Hose / Pump ${hose.hoseNumber} · ${hose.product}`}
          onTitlePress={() => setOpen((prev) => ({ ...prev, [hi]: !isOpen }))}
          collapsed={!isOpen}
          collapsedSummary={
            <View style={{ marginTop: 2, alignSelf: 'flex-start' }}>
              <Badge
                text={
                  missing.length === 0
                    ? 'All results entered ✓'
                    : `Still to enter: ${missing.join(', ')}`
                }
                tone={missing.length === 0 ? 'ok' : 'warn'}
              />
            </View>
          }
        >
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
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>Unit price (R/L)</Text>
              <TextInput
                style={numInput}
                keyboardType="decimal-pad"
                placeholder="—"
                value={numStr(hose.unitPrice)}
                onChangeText={(t) => setHose(hi, { unitPrice: parseNum(t) })}
              />
            </View>
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
            <View key={item.key}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 2 }}>
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
              {/* The paper note records these two as MEASURED values (#90):
                  burst dilation in ml (limit 50) and the zero-setting
                  advance of indication (0 expected). */}
              {item.key === 'nozzleBurst' || item.key === 'zeroSetting' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Text
                    style={{
                      fontSize: 11,
                      color:
                        item.key === 'nozzleBurst' &&
                        (hose.nozzleBurstMl ?? 0) > NOZZLE_BURST_LIMIT_ML
                          ? colors.red
                          : colors.muted,
                    }}
                  >
                    {item.key === 'nozzleBurst'
                      ? (hose.nozzleBurstMl ?? 0) > NOZZLE_BURST_LIMIT_ML
                        ? `Measured (ml): EXCEEDS ${NOZZLE_BURST_LIMIT_ML} ml limit`
                        : `Measured (ml, limit ${NOZZLE_BURST_LIMIT_ML})`
                      : 'Reading (ml)'}
                  </Text>
                  <TextInput
                    style={[numInput, { flex: 0, width: 110, minHeight: 38, paddingVertical: 6 }]}
                    keyboardType="numbers-and-punctuation"
                    placeholder="—"
                    value={numStr(
                      item.key === 'nozzleBurst' ? hose.nozzleBurstMl : hose.zeroSettingMl,
                    )}
                    onChangeText={(t) =>
                      setHose(
                        hi,
                        item.key === 'nozzleBurst'
                          ? { nozzleBurstMl: parseNum(t) }
                          : { zeroSettingMl: parseNum(t) },
                      )
                    }
                  />
                </View>
              ) : null}
            </View>
          ))}

          <Text style={{ fontWeight: '700', color: colors.ink, marginTop: 10 }}>
            EFD deliveries (VFD vs VREF, mL)
          </Text>
          {hose.deliveries.map((d, di) => {
            const isLastDelivery = di === hose.deliveries.length - 1;
            const FIELD_META: Record<(typeof DELIVERY_FIELDS)[number], { label: string; value?: number }> = {
              flowRateLpm: { label: 'Flow L/min', value: d.flowRateLpm },
              vrefMl: { label: 'VREF', value: d.vrefMl },
            };
            const planDelivery = testPlanFor(v).deliveries.find((pd) => pd.point === d.point);
            const nominal = d.vfdMl ?? planDelivery?.nominalMl ?? 0;
            return (
            <View key={di} style={{ borderTopWidth: 1, borderColor: colors.line, paddingVertical: 6 }}>
              <Text style={{ fontSize: 12, color: colors.ink }}>
                {planDelivery?.label ?? DELIVERY_POINT_LABELS[d.point]}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{FIELD_META.flowRateLpm.label}</Text>
                  <TextInput
                    ref={(r) => {
                      inputs.current[`${hi}.${di}.flowRateLpm`] = r;
                    }}
                    style={numInput}
                    keyboardType="decimal-pad"
                    placeholder="—"
                    value={numStr(d.flowRateLpm)}
                    onChangeText={(t) => setDelivery(hi, di, { flowRateLpm: parseNum(t) } as Partial<Delivery>)}
                    returnKeyType="next"
                    onSubmitEditing={() => focusNext(hi, di, 'flowRateLpm')}
                  />
                </View>
                {/* VFD is the volume the dispenser is SET to deliver — fixed
                    per the NRCS form (#87), never entered. */}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>VFD (fixed)</Text>
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: colors.line,
                      borderRadius: 10,
                      paddingHorizontal: 8,
                      paddingVertical: 10,
                      minHeight: 44,
                      backgroundColor: colors.mist,
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        color: colors.ink,
                        fontSize: 16,
                        fontFamily: fonts.mono,
                        fontVariant: ['tabular-nums', 'lining-nums'],
                      }}
                    >
                      {nominal.toLocaleString('en-ZA')}
                    </Text>
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{FIELD_META.vrefMl.label}</Text>
                  <TextInput
                    ref={(r) => {
                      inputs.current[`${hi}.${di}.vrefMl`] = r;
                    }}
                    style={numInput}
                    keyboardType="decimal-pad"
                    placeholder="—"
                    value={numStr(d.vrefMl)}
                    onChangeText={(t) => setDelivery(hi, di, { vrefMl: parseNum(t) } as Partial<Delivery>)}
                    returnKeyType={isLastDelivery ? 'done' : 'next'}
                    blurOnSubmit={isLastDelivery}
                    onSubmitEditing={() => focusNext(hi, di, 'vrefMl')}
                  />
                </View>
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
              {flowWindowWarning(hose, d) ? (
                <Text style={{ color: colors.amber, fontSize: 11, marginTop: 3 }}>
                  ⚠ {flowWindowWarning(hose, d)}
                </Text>
              ) : null}
            </View>
            );
          })}

          <Text style={{ fontWeight: '700', color: colors.ink, marginTop: 10 }}>Comments</Text>
          <TextInput
            style={[numInput, { fontFamily: fonts.body, fontSize: 14, minHeight: 64 }]}
            multiline
            textAlignVertical="top"
            placeholder="Optional: printed on the certificate's Comments row"
            value={hose.comments ?? ''}
            onChangeText={(t) => setHose(hi, { comments: t || undefined })}
          />
        </SectionCard>
        );
      })}

      <View style={{ marginHorizontal: 12 }}>
        <Button title="Continue to sign" onPress={continueToSign} />
        <Button
          title="Discard draft"
          kind="danger"
          onPress={() =>
            Alert.alert(
              'Discard this draft?',
              `${record?.certificateNumber ?? 'This certificate'} and everything entered on it will be deleted from this device. This cannot be undone.`,
              [
                { text: 'Keep', style: 'cancel' },
                {
                  text: 'Discard',
                  style: 'destructive',
                  onPress: () => {
                    discardCertificate(id).finally(() => router.replace('/home'));
                  },
                },
              ],
            )
          }
        />
      </View>
    </FormScrollView>
  );
}

import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { zodResolver } from '@hookform/resolvers/zod';
import { Control, useFieldArray, useForm, useWatch } from 'react-hook-form';
import type { CalibrationForm } from '@prowalco/schema';
import {
  DEFAULT_TOLERANCE_CLASS_ID,
  TOLERANCE_CLASSES,
  UNCERTAINTY_STATEMENT,
  calibrationFormSchema,
  computeRow,
} from '@prowalco/schema';
import { CameraCaptureModal } from '../../../src/components/CameraCapture';
import {
  Badge,
  Button,
  ChoiceField,
  DateField,
  NumberField,
  SectionCard,
  SwitchField,
  TextField,
  colors,
  styles,
} from '../../../src/components/ui';
import { deletePhoto, persistPhoto, photoUriForId, type PhotoRef } from '../../../src/lib/photos';
import { EQUIPMENT_REGISTER, PROCEDURES, SIGNATORIES } from '../../../src/data/registers';
import * as repo from '../../../src/db/certificateRepo';

/** Draft shape: same structure as CalibrationForm but tolerant of gaps while
 * the technician is still typing. Strict validation happens at review. */
type Draft = CalibrationForm;

/** Top-level form keys mapped to the on-screen sections, in layout order. */
const SECTION_DEFS = [
  { key: 'job', label: '1 Job' },
  { key: 'uut', label: '2 UUT' },
  { key: 'referenceStandards', label: '3 Standards' },
  { key: 'environment', label: '4 Environment' },
  { key: 'results', label: '5 Results' },
  { key: 'signOff', label: '6 Sign-off' },
] as const;

type SectionKey = (typeof SECTION_DEFS)[number]['key'];

/** Open items per section: zod issues grouped by top-level path, plus the
 * declaration tick (valid-but-false in zod, required for signing). */
function countSectionIssues(values: Draft): Record<SectionKey, number> {
  const counts = Object.fromEntries(SECTION_DEFS.map((s) => [s.key, 0])) as Record<
    SectionKey,
    number
  >;
  const parsed = calibrationFormSchema.safeParse(values);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const head = String(issue.path[0] ?? '');
      if (head in counts) counts[head as SectionKey] += 1;
    }
  }
  if (!values.signOff?.declarationAccepted) counts.signOff += 1;
  return counts;
}

function SectionNav({
  issues,
  onJump,
}: {
  issues: Record<SectionKey, number>;
  onJump: (key: SectionKey) => void;
}) {
  return (
    <View style={{ borderBottomWidth: 1, borderColor: colors.line, backgroundColor: colors.card }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 6 }}
      >
        {SECTION_DEFS.map((s) => {
          const n = issues[s.key];
          const done = n === 0;
          return (
            <Pressable
              key={s.key}
              onPress={() => onJump(s.key)}
              style={[
                styles.chip,
                { borderColor: done ? colors.green : colors.amber },
                done && { backgroundColor: '#e8f3ec' },
              ]}
            >
              <Text
                style={{ fontSize: 13, fontWeight: '600', color: done ? colors.green : colors.amber }}
              >
                {done ? `✓ ${s.label}` : `${s.label} · ${n}`}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const EMPTY_ROW = {
  nominalDeliveryL: 20,
  flowRateLpm: undefined as unknown as number,
  indicatedVolumeL: undefined as unknown as number,
  measuredVolumeL: undefined as unknown as number,
  errorMl: 0,
  errorPercent: 0,
  pass: false,
  toleranceClassId: DEFAULT_TOLERANCE_CLASS_ID,
};

/** How much of the MPE band a reading uses, as a colour-graded bar. */
function ToleranceBar({ errorPercent, toleranceClassId }: { errorPercent: number; toleranceClassId: string }) {
  const mpe = TOLERANCE_CLASSES[toleranceClassId]?.mpePercent;
  if (!mpe) return null;
  const usage = Math.abs(errorPercent) / mpe;
  const color = usage >= 1 ? colors.red : usage >= 0.75 ? colors.amber : colors.green;
  return (
    <View style={{ marginBottom: 8 }}>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' }}>
        <View style={{ width: `${Math.min(usage, 1) * 100}%`, height: 6, backgroundColor: color }} />
      </View>
      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
        {Math.round(usage * 100)}% of ±{mpe.toFixed(2)} % tolerance used
      </Text>
    </View>
  );
}

const ROW_FIELD_ORDER = ['nominalDeliveryL', 'flowRateLpm', 'indicatedVolumeL', 'measuredVolumeL'] as const;

function ResultRows({
  control,
  name,
  title,
}: {
  control: Control<Draft>;
  name: 'results.asFound' | 'results.asLeft';
  title: string;
}) {
  const { fields, append, remove, replace } = useFieldArray({ control, name });
  const rows = useWatch({ control, name }) as (typeof EMPTY_ROW)[] | undefined;
  const inputs = useRef<Record<string, TextInput | null>>({});

  const focusNext = (i: number, field: (typeof ROW_FIELD_ORDER)[number]) => {
    const at = ROW_FIELD_ORDER.indexOf(field);
    const nextKey =
      at < ROW_FIELD_ORDER.length - 1 ? `${i}.${ROW_FIELD_ORDER[at + 1]}` : `${i + 1}.${ROW_FIELD_ORDER[0]}`;
    inputs.current[nextKey]?.focus();
  };

  // Copy set-up values (nominal + flow) into a fresh point — never readings:
  // duplicated measurement data on a certificate is fabricated data.
  const duplicateLast = () => {
    const last = rows?.[rows.length - 1];
    append({
      ...EMPTY_ROW,
      nominalDeliveryL: last?.nominalDeliveryL ?? EMPTY_ROW.nominalDeliveryL,
      flowRateLpm: (last?.flowRateLpm ?? undefined) as never,
    });
  };

  const first = rows?.[0];
  const untouchedSingleRow =
    fields.length === 1 &&
    !(first && first.flowRateLpm > 0) &&
    !(first && first.indicatedVolumeL > 0) &&
    !(first && first.measuredVolumeL > 0);

  return (
    <SectionCard title={title}>
      {untouchedSingleRow ? (
        <Button
          title="Set up standard 3-point run"
          kind="secondary"
          onPress={() => replace([{ ...EMPTY_ROW }, { ...EMPTY_ROW }, { ...EMPTY_ROW }])}
        />
      ) : null}
      {fields.map((f, i) => {
        const row = rows?.[i];
        const computed =
          row && row.indicatedVolumeL > 0 && row.measuredVolumeL > 0
            ? computeRow(row.indicatedVolumeL, row.measuredVolumeL, row.toleranceClassId)
            : null;
        const isLast = i === fields.length - 1;
        return (
          <View key={f.id} style={{ borderTopWidth: i ? 1 : 0, borderColor: colors.line, paddingTop: i ? 10 : 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 }}>
              <Text style={{ fontWeight: '600', color: colors.ink, flex: 1 }}>Test point {i + 1}</Text>
              {computed ? (
                <Badge filled text={computed.pass ? 'PASS' : 'FAIL'} tone={computed.pass ? 'ok' : 'bad'} />
              ) : null}
            </View>
            {ROW_FIELD_ORDER.map((fieldName, fi) => (
              <NumberField
                key={fieldName}
                control={control}
                name={`${name}.${i}.${fieldName}` as never}
                label={
                  fieldName === 'nominalDeliveryL'
                    ? 'Nominal delivery (L)'
                    : fieldName === 'flowRateLpm'
                      ? 'Flow rate (L/min)'
                      : fieldName === 'indicatedVolumeL'
                        ? 'Indicated volume (L)'
                        : 'Measured volume (L)'
                }
                big
                inputRef={(r: TextInput | null) => {
                  inputs.current[`${i}.${fieldName}`] = r;
                }}
                returnKeyType={isLast && fi === ROW_FIELD_ORDER.length - 1 ? 'done' : 'next'}
                onSubmitEditing={() => focusNext(i, fieldName)}
              />
            ))}
            {computed ? (
              <>
                <Text style={{ color: colors.ink, marginBottom: 4 }}>
                  Error: {computed.errorMl.toFixed(1)} mL ({computed.errorPercent.toFixed(3)} %)
                </Text>
                <ToleranceBar errorPercent={computed.errorPercent} toleranceClassId={row!.toleranceClassId} />
              </>
            ) : (
              <Text style={{ color: colors.muted, marginBottom: 6 }}>
                Enter indicated + measured volumes to compute the error
              </Text>
            )}
            {fields.length > 1 && (
              <Button title="Remove point" kind="danger" onPress={() => remove(i)} />
            )}
          </View>
        );
      })}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button title="Add test point" kind="secondary" onPress={() => append({ ...EMPTY_ROW })} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Duplicate last set-up" kind="secondary" onPress={duplicateLast} />
        </View>
      </View>
    </SectionCard>
  );
}

export default function EditScreen() {
  const { id, section } = useLocalSearchParams<{ id: string; section?: string }>();
  const router = useRouter();
  const record = useMemo(() => repo.getById(id), [id]);

  const { control, getValues, setValue, watch } = useForm<Draft>({
    // Display-only validation: errors render inline as fields are touched,
    // but nothing here blocks draft autosave or navigation to review.
    resolver: zodResolver(calibrationFormSchema),
    mode: 'onChange',
    defaultValues: {
      schemaVersion: 1,
      referenceStandards: [],
      environment: { uutCondition: 'good' } as never,
      uut: { equipmentType: 'fuel_dispenser', manufacturer: 'Tatsuno', productGrade: 'ulp_95' } as never,
      results: {
        asFound: [{ ...EMPTY_ROW }],
        adjustmentPerformed: false,
        uncertaintyStatement: UNCERTAINTY_STATEMENT,
        verificationSealNumbers: [],
        photos: [],
      } as never,
      ...(record?.form as Draft | undefined),
    },
  });

  const [sectionIssues, setSectionIssues] = useState<Record<SectionKey, number>>(() =>
    countSectionIssues(getValues()),
  );
  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<Partial<Record<SectionKey, number>>>({});

  // Autosave every field change back to SQLite, and refresh the section
  // progress chips (both debounced).
  useEffect(() => {
    let saveTimer: ReturnType<typeof setTimeout>;
    let issuesTimer: ReturnType<typeof setTimeout>;
    const sub = watch(() => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => repo.saveDraftForm(id, getValues()), 800);
      clearTimeout(issuesTimer);
      issuesTimer = setTimeout(() => setSectionIssues(countSectionIssues(getValues())), 400);
    });
    return () => {
      clearTimeout(saveTimer);
      clearTimeout(issuesTimer);
      sub.unsubscribe();
    };
  }, [watch, getValues, id]);

  const jumpToSection = (key: SectionKey) => {
    const y = sectionY.current[key];
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(y - 6, 0), animated: true });
  };

  // Deep link from a review concern ("Review in form"): scroll to the named
  // section once layout has produced anchor positions.
  useEffect(() => {
    if (!section) return;
    const timer = setTimeout(() => jumpToSection(section as SectionKey), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const anchorProps = (key: SectionKey) => ({
    onLayout: (e: { nativeEvent: { layout: { y: number } } }) => {
      sectionY.current[key] = e.nativeEvent.layout.y;
    },
  });

  const standards = useWatch({ control, name: 'referenceStandards' }) ?? [];
  const adjustment = useWatch({ control, name: 'results.adjustmentPerformed' });
  const photos = (useWatch({ control, name: 'results.photos' }) ?? []) as PhotoRef[];
  const [scanOpen, setScanOpen] = useState(false);
  const [photoKind, setPhotoKind] = useState<PhotoRef['kind'] | null>(null);

  const onPhotoCaptured = async (tempUri: string) => {
    const kind = photoKind ?? 'other';
    setPhotoKind(null);
    try {
      const ref = await persistPhoto(tempUri, kind);
      setValue('results.photos', [...(getValues('results.photos') ?? []), ref], {
        shouldDirty: true,
      });
    } catch (err) {
      Alert.alert('Photo could not be saved', err instanceof Error ? err.message : String(err));
    }
  };

  const removePhoto = (index: number) => {
    const list = getValues('results.photos') ?? [];
    const removed = list[index];
    setValue(
      'results.photos',
      list.filter((_, i) => i !== index),
      { shouldDirty: true },
    );
    if (removed) void deletePhoto(removed.id);
  };

  if (!record) return <Text>Not found</Text>;

  const toggleStandard = (registerId: string) => {
    const current = getValues('referenceStandards') ?? [];
    const existing = current.findIndex((s) => s.registerId === registerId);
    if (existing >= 0) {
      setValue('referenceStandards', current.filter((_, i) => i !== existing));
    } else {
      const std = EQUIPMENT_REGISTER.find((s) => s.registerId === registerId)!;
      setValue('referenceStandards', [...current, std]); // serial/cert/due auto-fill from register
    }
  };

  const continueToReview = () => {
    const values = getValues();
    // Recompute every row so stored values always match the shared tolerance
    // math (the backend re-verifies and rejects mismatches).
    for (const key of ['asFound', 'asLeft'] as const) {
      const rows = values.results[key];
      if (!rows) continue;
      rows.forEach((row, i) => {
        if (row.indicatedVolumeL > 0 && row.measuredVolumeL > 0) {
          const c = computeRow(row.indicatedVolumeL, row.measuredVolumeL, row.toleranceClassId);
          rows[i] = { ...row, errorMl: c.errorMl, errorPercent: c.errorPercent, pass: c.pass };
        }
      });
    }
    if (!values.results.adjustmentPerformed) delete values.results.asLeft;
    repo.saveDraftForm(id, values);
    router.push({ pathname: '/certificate/[id]/review', params: { id } });
  };

  const signatoryOptions = SIGNATORIES.map((s) => ({ value: s.id, label: s.name }));

  return (
    <View style={styles.screen}>
      <SectionNav issues={sectionIssues} onJump={jumpToSection} />
      <ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: 40 }}>
      <View {...anchorProps('job')}>
      <SectionCard title="1 — Job & customer">
        <TextField control={control} name="job.certificateNumber" label="Certificate number" editable={false} />
        <TextField control={control} name="job.workOrderNumber" label="Work order / job number" optional />
        <TextField control={control} name="job.customerName" label="Customer / site name" />
        <TextField control={control} name="job.siteAddress" label="Site address" multiline />
        <TextField control={control} name="job.siteAssetNumber" label="Site / asset number" optional />
        <DateField control={control} name="job.calibrationDate" label="Calibration date" />
      </SectionCard>
      </View>

      <View {...anchorProps('uut')}>
      <SectionCard title="2 — Unit under test">
        <ChoiceField
          control={control}
          name="uut.equipmentType"
          label="Equipment type"
          options={[
            { value: 'fuel_dispenser', label: 'Fuel dispenser' },
            { value: 'pump', label: 'Pump' },
            { value: 'flow_meter', label: 'Flow meter' },
            { value: 'pressure_transmitter', label: 'Pressure transmitter' },
            { value: 'other', label: 'Other' },
          ]}
        />
        <TextField control={control} name="uut.manufacturer" label="Manufacturer" />
        <TextField control={control} name="uut.modelNumber" label="Model number" />
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <TextField control={control} name="uut.serialNumber" label="Serial number" />
          </View>
          <Pressable
            onPress={() => setScanOpen(true)}
            style={{
              marginTop: 18,
              minHeight: 38,
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: colors.green,
              borderRadius: 6,
              paddingHorizontal: 12,
            }}
          >
            <Text style={{ color: colors.green, fontWeight: '600' }}>Scan</Text>
          </Pressable>
        </View>
        <TextField control={control} name="uut.nozzleId" label="Pump / hose / nozzle ID" optional />
        <ChoiceField
          control={control}
          name="uut.productGrade"
          label="Product / grade"
          options={[
            { value: 'ulp_93', label: 'ULP 93' },
            { value: 'ulp_95', label: 'ULP 95' },
            { value: 'diesel_50ppm', label: 'Diesel 50ppm' },
            { value: 'diesel_500ppm', label: 'Diesel 500ppm' },
            { value: 'paraffin', label: 'Paraffin' },
            { value: 'other', label: 'Other' },
          ]}
        />
        <NumberField control={control} name="uut.meterKFactorBefore" label="Meter K-factor before" optional />
      </SectionCard>
      </View>

      <View {...anchorProps('referenceStandards')}>
      <SectionCard title="3 — Reference standards">
        <Text style={{ color: colors.muted, marginBottom: 6 }}>
          Select from the equipment register. Serial, certificate and due date auto-fill and cannot
          be edited; expired standards block signing.
        </Text>
        {EQUIPMENT_REGISTER.map((std) => {
          const selected = standards.some((s) => s.registerId === std.registerId);
          return (
            <Button
              key={std.registerId}
              kind={selected ? 'primary' : 'secondary'}
              title={`${selected ? '✓ ' : ''}${std.description} · ${std.serialNumber} · due ${std.calibrationDueDate}`}
              onPress={() => toggleStandard(std.registerId)}
            />
          );
        })}
      </SectionCard>
      </View>

      <View {...anchorProps('environment')}>
      <SectionCard title="4 — Environment & method">
        <NumberField control={control} name="environment.ambientTempC" label="Ambient temperature (°C)" />
        <NumberField control={control} name="environment.productTempC" label="Product temperature (°C)" />
        <ChoiceField control={control} name="environment.procedureRef" label="Procedure" options={PROCEDURES} />
        <ChoiceField
          control={control}
          name="environment.uutCondition"
          label="Condition of UUT"
          options={[
            { value: 'good', label: 'Good' },
            { value: 'damaged', label: 'Damaged' },
            { value: 'leaks_noted', label: 'Leaks noted' },
            { value: 'other', label: 'Other' },
          ]}
        />
        <TextField control={control} name="environment.conditionNotes" label="Condition notes" multiline optional />
      </SectionCard>
      </View>

      <View {...anchorProps('results')}>
      <ResultRows control={control} name="results.asFound" title="5 — Results (as found)" />
      <SectionCard title="Adjustment">
        <SwitchField control={control} name="results.adjustmentPerformed" label="Adjustment performed?" />
        <NumberField control={control} name="results.meterKFactorAfter" label="Meter K-factor after" optional />
      </SectionCard>
      {adjustment ? (
        <ResultRows control={control} name="results.asLeft" title="5b — Results (as left)" />
      ) : null}
      <SectionCard title="Photos">
        <Text style={{ color: colors.muted, marginBottom: 6, fontSize: 13 }}>
          Photograph the seal, totaliser and display. Each photo is fingerprinted (SHA-256) into
          the audit trail.
        </Text>
        <View style={styles.chipsRow}>
          {(['seal', 'totaliser', 'display', 'other'] as const).map((k) => (
            <Pressable key={k} onPress={() => setPhotoKind(k)} style={styles.chip}>
              <Text style={styles.chipText}>📷 {k[0].toUpperCase() + k.slice(1)}</Text>
            </Pressable>
          ))}
        </View>
        {photos.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
            {photos.map((p, i) => (
              <View key={p.id} style={{ marginRight: 10, alignItems: 'center' }}>
                <Image
                  source={{ uri: photoUriForId(p.id) }}
                  style={{ width: 84, height: 84, borderRadius: 6, backgroundColor: colors.line }}
                />
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>{p.kind}</Text>
                <Pressable onPress={() => removePhoto(i)} hitSlop={8}>
                  <Text style={{ color: colors.red, fontSize: 12 }}>Remove</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}
      </SectionCard>

      <SectionCard title="Remarks & seals">
        <TextField control={control} name="results.remarks" label="Remarks / notes" multiline optional />
        <TextField
          control={control}
          name="results.verificationSealNumbers.0"
          label="Verification seal number"
          optional
        />
      </SectionCard>
      </View>

      <View {...anchorProps('signOff')}>
      <SectionCard title="6 — Sign-off">
        <TextField control={control} name="signOff.calibratedBy.name" label="Calibrated by" editable={false} />
        <ChoiceField
          control={control}
          name="signOff.technicalSignatory.id"
          label="Technical signatory"
          options={signatoryOptions}
        />
        <SwitchField
          control={control}
          name="signOff.declarationAccepted"
          label="I certify these results are true and the procedure was followed"
        />
      </SectionCard>
      </View>

      <View style={{ marginHorizontal: 12 }}>
        <Button
          title="Continue to review & sign"
          onPress={() => {
            // Resolve the signatory name from the picked id before review.
            const sigId = getValues('signOff.technicalSignatory.id');
            const sig = SIGNATORIES.find((s) => s.id === sigId);
            if (sig) setValue('signOff.technicalSignatory.name', sig.name);
            try {
              continueToReview();
            } catch (err) {
              Alert.alert('Cannot continue', err instanceof Error ? err.message : String(err));
            }
          }}
        />
      </View>
      </ScrollView>

      <CameraCaptureModal
        mode="barcode"
        visible={scanOpen}
        title="Scan the serial number barcode / QR"
        onClose={() => setScanOpen(false)}
        onBarcode={(data) => {
          setScanOpen(false);
          setValue('uut.serialNumber', data, { shouldDirty: true, shouldTouch: true });
        }}
      />
      <CameraCaptureModal
        mode="photo"
        visible={photoKind != null}
        title={`Photograph: ${photoKind ?? ''}`}
        onClose={() => setPhotoKind(null)}
        onPhoto={onPhotoCaptured}
      />
    </View>
  );
}

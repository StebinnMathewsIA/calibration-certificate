import DateTimePicker from '@react-native-community/datetimepicker';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Control, Controller, FieldValues, Path } from 'react-hook-form';

/**
 * Prowalco brand tokens (see brand guidelines). Green and blue are sampled
 * from the logo; navy is the app's structural colour.
 *
 * HARD RULES enforced by these components:
 *  - green fills take NAVY text (white on #A5CD39 fails WCAG);
 *  - coloured small text on white only ever uses greenText / blueText;
 *  - status chips pair colour with a word, tinted bg + dark status text;
 *  - brand green never means "success" — pass states use the #5F7A17 family;
 *  - numerics wear Roboto Mono with tabular figures (styles.mono);
 *  - sentence case everywhere, no ALL CAPS.
 */
export const colors = {
  // Brand core
  green: '#A5CD39', // pw-green — fills/CTAs only, always with navy text
  greenHover: '#8CB32B',
  greenText: '#5F7A17', // the only green allowed as small text; pass/active
  greenTint: '#F1F7DE',
  blue: '#10B0E6', // pw-blue — accents; never small text
  blueText: '#086A8C', // links / blue small text
  blueTint: '#E3F5FC',
  navy: '#123F73', // structure: app bars, headings, button text on green
  navyHover: '#1B4E8A',
  navy900: '#0B2A4A',
  // Neutrals
  ink: '#0B2A4A', // primary text
  muted: '#5B6B7C', // pw-steel — secondary text
  mist: '#E8EDF2',
  line: '#E1E6EB', // borders, hairlines
  bg: '#F7F9FB', // pw-offwhite
  card: '#FFFFFF',
  // Status (functional, not brand)
  red: '#9B2626', // fail text on white/tint
  redFill: '#D03B3B',
  redTint: '#FBE5E5',
  amber: '#8A5A0A', // due/warning text
  amberFill: '#EF9F27',
  amberTint: '#FDF2DC',
};

/** Font families (loaded in the root layout via @expo-google-fonts). */
export const fonts = {
  heading: 'BarlowSemiCondensed_600SemiBold',
  headingMedium: 'BarlowSemiCondensed_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  mono: 'RobotoMono_400Regular',
  monoMedium: 'RobotoMono_500Medium',
};

export function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function FieldRow({
  label,
  optional,
  error,
  children,
}: {
  label: string;
  optional?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.label}>
        {label}
        {optional ? <Text style={styles.labelOptional}> (optional)</Text> : null}
      </Text>
      {children}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

interface TextFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: Path<T>;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  editable?: boolean;
  optional?: boolean;
}

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  placeholder,
  multiline,
  editable = true,
  optional,
}: TextFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <FieldRow label={label} optional={optional}>
          <TextInput
            style={[styles.input, !editable && styles.inputDisabled, multiline && styles.multiline]}
            value={field.value == null ? '' : String(field.value)}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder={placeholder}
            multiline={multiline}
            editable={editable}
          />
        </FieldRow>
      )}
    />
  );
}

export function NumberField<T extends FieldValues>({
  control,
  name,
  label,
  placeholder,
  optional,
}: TextFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <FieldRow label={label} optional={optional}>
          <TextInput
            style={[styles.input, styles.mono]}
            value={field.value == null || Number.isNaN(field.value) ? '' : String(field.value)}
            keyboardType="decimal-pad"
            onChangeText={(text) => {
              const n = Number(text.replace(',', '.'));
              field.onChange(text === '' ? undefined : Number.isNaN(n) ? text : n);
            }}
            onBlur={field.onBlur}
            placeholder={placeholder}
          />
        </FieldRow>
      )}
    />
  );
}

export function ChoiceField<T extends FieldValues>({
  control,
  name,
  label,
  options,
  optional,
}: TextFieldProps<T> & { options: { value: string; label: string }[] }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <FieldRow label={label} optional={optional}>
          <View style={styles.chipsRow}>
            {options.map((o) => (
              <Pressable
                key={o.value}
                onPress={() => field.onChange(o.value)}
                style={[styles.chip, field.value === o.value && styles.chipActive]}
              >
                <Text style={field.value === o.value ? styles.chipTextActive : styles.chipText}>
                  {o.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </FieldRow>
      )}
    />
  );
}

export function SwitchField<T extends FieldValues>({ control, name, label }: TextFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <View style={styles.switchRow}>
          <Text style={[styles.label, { flex: 1 }]}>{label}</Text>
          <Switch value={Boolean(field.value)} onValueChange={field.onChange} />
        </View>
      )}
    />
  );
}

/** Native date picker presented as an input row. Value is a YYYY-MM-DD
 * string; days never shift across timezones (local-midnight parsing). */
export function DateInput({
  value,
  onChange,
  placeholder = 'Select date',
}: {
  value: string;
  onChange: (isoDate: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = React.useState(false);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date();
  return (
    <View>
      <Pressable onPress={() => setShow(true)} style={styles.input}>
        <Text style={[styles.mono, { fontSize: 14, color: value ? colors.ink : colors.muted }]}>
          {value || placeholder}
        </Text>
      </Pressable>
      {show ? (
        <DateTimePicker
          value={date}
          mode="date"
          onChange={(event, selected) => {
            setShow(false);
            if (event.type === 'set' && selected) {
              const y = selected.getFullYear();
              const m = String(selected.getMonth() + 1).padStart(2, '0');
              const d = String(selected.getDate()).padStart(2, '0');
              onChange(`${y}-${m}-${d}`);
            }
          }}
        />
      ) : null}
    </View>
  );
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  busy,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
}) {
  // Brand recipes: primary = green fill + NAVY text (never white on green);
  // secondary = navy outline; danger = solid status red + white text.
  const bg = kind === 'primary' ? colors.green : kind === 'danger' ? colors.redFill : 'transparent';
  const fg = kind === 'primary' ? colors.navy : kind === 'danger' ? '#fff' : colors.navy;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={[
        styles.button,
        { backgroundColor: bg, borderColor: kind === 'secondary' ? colors.navy : bg },
        (disabled || busy) && { opacity: 0.5 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, fontFamily: fonts.bodyMedium, fontSize: 15 }}>{title}</Text>
      )}
    </Pressable>
  );
}

/** Status chip: tinted pill + dark status text (never colour alone — callers
 * always pass a word). `filled` is accepted for compatibility but chips are
 * always tinted per the brand recipe. `mono` sets Roboto Mono for numeric
 * readouts (e.g. EFD values). */
export function Badge({
  text,
  tone,
  mono,
}: {
  text: string;
  tone: 'ok' | 'warn' | 'bad' | 'muted';
  filled?: boolean;
  mono?: boolean;
}) {
  const map = {
    ok: { bg: colors.greenTint, fg: colors.greenText },
    warn: { bg: colors.amberTint, fg: colors.amber },
    bad: { bg: colors.redTint, fg: colors.red },
    muted: { bg: colors.mist, fg: colors.muted },
  } as const;
  return (
    <View style={[styles.badge, { backgroundColor: map[tone].bg }]}>
      <Text
        style={[
          { color: map[tone].fg, fontSize: 12, fontFamily: fonts.bodyMedium },
          mono && { fontFamily: fonts.monoMedium, fontVariant: ['tabular-nums', 'lining-nums'] },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardTitle: {
    fontSize: 18,
    fontFamily: fonts.heading,
    color: colors.navy,
    marginBottom: 8,
  },
  fieldRow: { marginBottom: 12 },
  label: { fontSize: 12, fontFamily: fonts.body, color: colors.muted, marginBottom: 4 },
  labelOptional: { fontStyle: 'italic' },
  errorText: { fontSize: 12, fontFamily: fonts.body, color: colors.red, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: fonts.body,
    color: colors.ink,
    backgroundColor: colors.card,
  },
  inputDisabled: { backgroundColor: colors.mist, color: colors.muted },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  /** Numeric readouts: Roboto Mono + tabular figures so columns align. */
  mono: { fontFamily: fonts.mono, fontVariant: ['tabular-nums', 'lining-nums'] },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  // Green fill takes navy text (hard rule 1).
  chipActive: { backgroundColor: colors.green, borderColor: colors.green },
  chipText: { color: colors.ink, fontSize: 13, fontFamily: fonts.body },
  chipTextActive: { color: colors.navy, fontSize: 13, fontFamily: fonts.bodyMedium },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  button: {
    borderRadius: 10,
    paddingVertical: 13,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1.5,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
});

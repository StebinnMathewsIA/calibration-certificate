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

export const colors = {
  green: '#1a7a3a',
  blue: '#0b4f8a',
  red: '#b00020',
  amber: '#a06000',
  ink: '#16211c',
  muted: '#5b6b62',
  line: '#d6ded9',
  bg: '#f5f7f5',
  card: '#ffffff',
};

export function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.label}>{label}</Text>
      {children}
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
}

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  placeholder,
  multiline,
  editable = true,
}: TextFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <FieldRow label={label}>
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
}: TextFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <FieldRow label={label}>
          <TextInput
            style={styles.input}
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
}: TextFieldProps<T> & { options: { value: string; label: string }[] }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <FieldRow label={label}>
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
  const bg = kind === 'primary' ? colors.green : kind === 'danger' ? colors.red : colors.card;
  const fg = kind === 'secondary' ? colors.green : '#fff';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={[
        styles.button,
        { backgroundColor: bg, borderColor: colors.green },
        kind === 'secondary' && styles.buttonSecondary,
        (disabled || busy) && { opacity: 0.5 },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: '600' }}>{title}</Text>}
    </Pressable>
  );
}

export function Badge({ text, tone }: { text: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }) {
  const map = { ok: colors.green, warn: colors.amber, bad: colors.red, muted: colors.muted };
  return (
    <View style={[styles.badge, { borderColor: map[tone] }]}>
      <Text style={{ color: map[tone], fontSize: 12, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 14,
    marginHorizontal: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  fieldRow: { marginBottom: 10 },
  label: { fontSize: 12, color: colors.muted, marginBottom: 3 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: '#fff',
  },
  inputDisabled: { backgroundColor: '#eef1ee', color: colors.muted },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipActive: { backgroundColor: colors.green, borderColor: colors.green },
  chipText: { color: colors.ink, fontSize: 13 },
  chipTextActive: { color: '#fff', fontSize: 13 },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  button: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
  },
  buttonSecondary: { backgroundColor: '#fff' },
  badge: {
    borderWidth: 1.5,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
});

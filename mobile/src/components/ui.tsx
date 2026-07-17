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
import DateTimePicker from '@react-native-community/datetimepicker';
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

/** Zod's default messages are developer-speak; translate the common ones. */
function humanizeError(message?: string): string | undefined {
  if (!message) return message;
  if (/received undefined|received null/i.test(message)) return 'Required';
  if (/at least 1 character/i.test(message)) return 'Required';
  if (/expected number/i.test(message)) return 'Enter a number';
  return message;
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
      render={({ field, fieldState }) => {
        // Only surface errors once the technician has interacted with the
        // field — an empty draft must not open covered in red.
        const error =
          fieldState.error && (fieldState.isTouched || fieldState.isDirty)
            ? humanizeError(fieldState.error.message)
            : undefined;
        return (
          <FieldRow label={label} optional={optional} error={error}>
            <TextInput
              style={[
                styles.input,
                !editable && styles.inputDisabled,
                multiline && styles.multiline,
                error != null && styles.inputError,
              ]}
              value={field.value == null ? '' : String(field.value)}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder={placeholder}
              multiline={multiline}
              editable={editable}
            />
          </FieldRow>
        );
      }}
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
      render={({ field, fieldState }) => {
        const error =
          fieldState.error && (fieldState.isTouched || fieldState.isDirty)
            ? humanizeError(fieldState.error.message)
            : undefined;
        return (
          <FieldRow label={label} optional={optional} error={error}>
            <TextInput
              style={[styles.input, error != null && styles.inputError]}
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
        );
      }}
    />
  );
}

export function DateField<T extends FieldValues>({
  control,
  name,
  label,
  optional,
}: TextFieldProps<T>) {
  const [show, setShow] = React.useState(false);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const error =
          fieldState.error && (fieldState.isTouched || fieldState.isDirty)
            ? humanizeError(fieldState.error.message)
            : undefined;
        const value = typeof field.value === 'string' ? field.value : '';
        // Parse as local midnight so the shown day never shifts with timezone.
        const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date();
        return (
          <FieldRow label={label} optional={optional} error={error}>
            <Pressable
              onPress={() => setShow(true)}
              style={[styles.input, error != null && styles.inputError]}
            >
              <Text style={{ fontSize: 14, color: value ? colors.ink : colors.muted }}>
                {value || 'Select date'}
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
                    field.onChange(`${y}-${m}-${d}`);
                    field.onBlur();
                  }
                }}
              />
            ) : null}
          </FieldRow>
        );
      }}
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
      render={({ field, fieldState }) => {
        const error =
          fieldState.error && (fieldState.isTouched || fieldState.isDirty)
            ? humanizeError(fieldState.error.message)
            : undefined;
        return (
          <FieldRow label={label} optional={optional} error={error}>
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
        );
      }}
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
  labelOptional: { fontStyle: 'italic', fontWeight: '400' },
  errorText: { fontSize: 12, color: colors.red, marginTop: 3 },
  inputError: { borderColor: colors.red },
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

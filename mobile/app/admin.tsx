/**
 * Admin screen (#72): grant/revoke manager+admin roles and allocate
 * technicians to managers. Every rule is enforced server-side (admin-only
 * SQL guards, last-admin protection) — this screen is just the hands.
 */
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import {
  RoleEntry,
  listAllocations,
  listRoles,
  listTechnicians,
  setAllocation,
  setRole,
} from '../src/api/client';
import { useAuth } from '../src/auth/AuthContext';
import { Badge, Button, SectionCard, colors, styles } from '../src/components/ui';

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: 10,
  paddingHorizontal: 10,
  paddingVertical: 8,
  marginBottom: 8,
  color: colors.ink,
  backgroundColor: '#fff',
} as const;

export default function AdminScreen() {
  const { accessToken } = useAuth();
  const [roles, setRoles] = useState<RoleEntry[] | null>(null);
  const [allocations, setAllocations] = useState<Record<string, string[]>>({});
  const [techs, setTechs] = useState<{ staffCode: string; name: string | null }[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'manager' | 'admin'>('manager');
  const [allocManager, setAllocManager] = useState<string | null>(null);
  const [allocFilter, setAllocFilter] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listRoles(accessToken).then(setRoles).catch(() => {});
    listAllocations(accessToken)
      .then((a) => setAllocations(a ?? {}))
      .catch(() => {});
    listTechnicians(accessToken)
      .then((l) => setTechs(l ?? []))
      .catch(() => {});
  }, [accessToken]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      Alert.alert('Refused', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (roles === null) {
    return (
      <Text style={{ padding: 16, color: colors.muted }}>
        Admin access required (or still loading).
      </Text>
    );
  }

  const allocated = allocManager ? (allocations[allocManager] ?? []) : [];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <SectionCard title="Roles">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 6 }}>
          Managers can view-as their allocated technicians and search the certificate archive.
          Admins can do everything, including this screen. The last admin can never be removed.
        </Text>
        {roles.map((r) => (
          <View
            key={r.email}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              borderTopWidth: 1,
              borderColor: colors.line,
              paddingVertical: 8,
              gap: 8,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink, fontSize: 13 }}>{r.email}</Text>
              <Text style={{ color: colors.muted, fontSize: 11 }}>since {r.createdAt}</Text>
            </View>
            <Badge text={r.role} tone={r.role === 'admin' ? 'ok' : 'warn'} />
            <Text
              onPress={() =>
                busy
                  ? undefined
                  : Alert.alert('Revoke role', `Remove ${r.role} from ${r.email}?`, [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Revoke',
                        style: 'destructive',
                        onPress: () =>
                          void run(async () => setRoles(await setRole(accessToken, r.email, null))),
                      },
                    ])
              }
              style={{ color: colors.red, fontSize: 12, textDecorationLine: 'underline' }}
            >
              revoke
            </Text>
          </View>
        ))}
        <Text style={{ fontWeight: '700', color: colors.ink, marginTop: 10, marginBottom: 4 }}>
          Grant a role
        </Text>
        <TextInput
          style={inputStyle}
          value={newEmail}
          onChangeText={setNewEmail}
          placeholder="person@prowalco.co.za"
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['manager', 'admin'] as const).map((r) => (
            <View key={r} style={{ flex: 1 }}>
              <Button
                title={r}
                kind={newRole === r ? 'primary' : 'secondary'}
                onPress={() => setNewRole(r)}
              />
            </View>
          ))}
        </View>
        <Button
          title={`Grant ${newRole}`}
          busy={busy}
          onPress={() =>
            void run(async () => {
              setRoles(await setRole(accessToken, newEmail.trim(), newRole));
              setNewEmail('');
            })
          }
        />
      </SectionCard>

      <SectionCard title="Technician allocations">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 6 }}>
          An allocated manager's view-as is limited to their technicians; a manager with no
          allocation may view anyone.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {roles.map((r) => (
            <Button
              key={r.email}
              title={`${r.email.split('@')[0]} (${(allocations[r.email] ?? []).length})`}
              kind={allocManager === r.email ? 'primary' : 'secondary'}
              onPress={() => setAllocManager(allocManager === r.email ? null : r.email)}
            />
          ))}
        </View>
        {allocManager ? (
          <View style={{ marginTop: 8 }}>
            <TextInput
              style={inputStyle}
              value={allocFilter}
              onChangeText={setAllocFilter}
              placeholder="Search technicians"
            />
            {techs
              .filter((t) => {
                const q = allocFilter.trim().toLowerCase();
                if (!q) return allocated.includes(t.staffCode);
                return (
                  (t.name ?? '').toLowerCase().includes(q) ||
                  t.staffCode.toLowerCase().includes(q)
                );
              })
              .slice(0, 15)
              .map((t) => {
                const on = allocated.includes(t.staffCode);
                return (
                  <Text
                    key={t.staffCode}
                    onPress={() =>
                      busy
                        ? undefined
                        : void run(async () =>
                            setAllocations(
                              await setAllocation(accessToken, allocManager, t.staffCode, !on),
                            ),
                          )
                    }
                    style={{
                      paddingVertical: 8,
                      borderTopWidth: 1,
                      borderColor: colors.line,
                      color: on ? colors.greenText : colors.ink,
                      fontSize: 14,
                    }}
                  >
                    {on ? '✓ ' : '○ '}
                    {t.name ?? t.staffCode}{' '}
                    <Text style={{ color: colors.muted, fontSize: 12 }}>({t.staffCode})</Text>
                  </Text>
                );
              })}
            {!allocFilter.trim() && allocated.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>
                No technicians allocated — search above to add some.
              </Text>
            ) : null}
          </View>
        ) : null}
      </SectionCard>
    </ScrollView>
  );
}

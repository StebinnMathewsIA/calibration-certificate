/**
 * Admin screen (#72): grant/revoke manager+admin roles and allocate
 * technicians to managers. Every rule is enforced server-side (admin-only
 * SQL guards, last-admin protection) — this screen is just the hands.
 */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  AllocationManager,
  RoleEntry,
  getAllocationTree,
  listRoles,
  setRole,
} from '../src/api/client';
import { useAuth } from '../src/auth/AuthContext';
import { Badge, Button, SectionCard, colors, fonts, styles } from '../src/components/ui';

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
  const router = useRouter();
  const [roles, setRoles] = useState<RoleEntry[] | null>(null);
  const [tree, setTree] = useState<AllocationManager[] | null>(null);
  const [openManagers, setOpenManagers] = useState<Record<string, boolean>>({});
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'manager' | 'admin'>('manager');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listRoles(accessToken).then(setRoles).catch(() => {});
    getAllocationTree(accessToken)
      .then(setTree)
      .catch(() => setTree([]));
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

      {/* The reporting tree (#146), backed by technician_allocations and
          manager_hierarchy (#139, #140): the store that scopes stock and
          teams. The editor this replaces wrote to the OLD view-as
          allocation store from #77, which scopes view-as only, so it was
          two stores with one UI pointed at the wrong one. Detail and
          moves live on the technician page. */}
      <SectionCard title="Technician allocations">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 6 }}>
          Who reports to whom. Tap a technician for detail, and to move them to another
          manager.
        </Text>
        {tree === null ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>Loading…</Text>
        ) : tree.length === 0 ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            No managers are recorded in the hierarchy yet.
          </Text>
        ) : (
          tree.map((m) => {
            const expanded = openManagers[m.email] ?? false;
            return (
              <View key={m.email} style={{ borderTopWidth: 1, borderTopColor: colors.line }}>
                <Pressable
                  onPress={() => setOpenManagers((o) => ({ ...o, [m.email]: !expanded }))}
                  accessibilityRole="button"
                  accessibilityLabel={`${m.name}, ${m.technicians.length} technicians`}
                  accessibilityState={{ expanded }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, color: colors.navy, fontFamily: fonts.bodyMedium }}>
                      {m.name}
                    </Text>
                    {m.reportsTo ? (
                      <Text style={{ fontSize: 11, color: colors.muted }}>
                        reports to {m.reportsTo}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={{ fontSize: 12, color: colors.muted }}>
                    {m.technicians.length}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.muted }}>{expanded ? '▴' : '▾'}</Text>
                </Pressable>
                {expanded
                  ? m.technicians.map((t) => (
                      <Pressable
                        key={t.staffCode}
                        onPress={() =>
                          router.push({ pathname: '/technician/[staff]', params: { staff: t.staffCode } })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${t.technicianName ?? t.staffCode}`}
                        style={{
                          paddingVertical: 8,
                          paddingLeft: 12,
                          // Former technicians dim rather than vanish: an
                          // admin is exactly who needs to see them (#141).
                          opacity: t.rosterStatus === 'former' ? 0.5 : 1,
                        }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ flex: 1, fontSize: 14, color: colors.ink }}>
                            {t.technicianName ?? t.staffCode}
                          </Text>
                          {t.rosterStatus === 'former' ? <Badge text="Former" tone="warn" /> : null}
                        </View>
                        <Text style={{ fontSize: 11, color: colors.muted }}>
                          {t.vanStatus === 'no_van'
                            ? 'Holds no van stock'
                            : t.vanDescription ?? t.vanCode ?? 'Van not set'}
                        </Text>
                      </Pressable>
                    ))
                  : null}
              </View>
            );
          })
        )}
      </SectionCard>
    </ScrollView>
  );
}

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
import { ManagerTree } from '../src/components/ManagerTree';
import { TreeBoundary } from '../src/components/TreeBoundary';
import { CrashRecord, clearCrash, lastCrash } from '../src/diag/crashJournal';
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
  const [crash, setCrash] = useState<CrashRecord | null>(null);

  useEffect(() => {
    setCrash(lastCrash());
  }, []);

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
      {crash ? (
        <SectionCard title="Last app error">
          <Text style={{ color: colors.red, fontSize: 12 }}>
            {crash.at.slice(0, 16).replace('T', ' ')}
            {crash.isFatal ? ' (fatal)' : ''}
          </Text>
          <Text style={{ color: colors.ink, fontSize: 12, marginTop: 4 }}>{crash.message}</Text>
          {crash.stack ? (
            <Text style={{ color: colors.muted, fontSize: 10, marginTop: 4 }} numberOfLines={8}>
              {crash.stack}
            </Text>
          ) : null}
          <Button
            title="Clear"
            kind="secondary"
            onPress={() => {
              clearCrash();
              setCrash(null);
            }}
          />
        </SectionCard>
      ) : null}

      <SectionCard title="Roles">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 6 }}>
          Managers can work as their allocated technicians and search the certificate archive.
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

      {/* The reporting tree (#146, nested per the owner's reference in
          #147), backed by technician_allocations and manager_hierarchy:
          the store that scopes stock and teams. Rendered by the same
          component as the stock tab, so the two cannot drift apart. */}
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
          <TreeBoundary>
          <ManagerTree
            managers={tree}
            onTechnicianPress={(t) =>
              router.push({ pathname: '/technician/[staff]', params: { staff: t.staffCode } })
            }
          />
          </TreeBoundary>
        )}
      </SectionCard>
    </ScrollView>
  );
}

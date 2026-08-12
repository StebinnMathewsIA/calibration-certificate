/**
 * Technician detail (#146): who they are, their van, and who they report
 * to. For an admin, the place an allocation is changed.
 *
 * The move writes through app_allocation_move, which enforces admin
 * itself: hiding the control from non-admins here is presentation, the
 * server is the rule. Moved rows are marked manual so a later OnKey seed
 * cannot quietly undo a decision a person made (#139).
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import {
  TechnicianDetail,
  getAllocationTargets,
  getTechnicianDetail,
  moveAllocation,
} from '../../src/api/client';
import { getWhoami } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { Badge, Button, SectionCard, colors, fonts } from '../../src/components/ui';
import { dropCache } from '../../src/db/cache';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 6, gap: 12 }}>
      <Text style={{ width: 110, fontSize: 12, color: colors.muted }}>{label}</Text>
      <Text style={{ flex: 1, fontSize: 14, color: colors.ink }}>{value}</Text>
    </View>
  );
}

export default function TechnicianDetailScreen() {
  const { staff } = useLocalSearchParams<{ staff: string }>();
  const router = useRouter();
  const { accessToken } = useAuth();
  const [role, setRole] = useState<'manager' | 'admin' | null>(null);

  const [detail, setDetail] = useState<TechnicianDetail | null>(null);
  const [targets, setTargets] = useState<{ email: string; name: string }[]>([]);
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getTechnicianDetail(accessToken, String(staff))
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load'));
    getAllocationTargets(accessToken)
      .then(setTargets)
      .catch(() => {});
    getWhoami(accessToken)
      .then((who) => setRole(who.role))
      .catch(() => {});
  }, [accessToken, staff]);

  React.useEffect(() => {
    load();
  }, [load]);

  const move = (email: string, name: string) => {
    Alert.alert(
      'Move technician',
      `Allocate ${detail?.technicianName ?? String(staff)} to ${name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move',
          onPress: () => {
            setBusy(true);
            moveAllocation(accessToken, String(staff), email)
              .then((updated) => {
                setDetail(updated);
                setMoving(false);
                // The stock tab and the tree both cache their scope, and
                // an allocation that moved is exactly what those caches
                // are now wrong about.
                dropCache('alloc:tree:v2');
                dropCache('stock:vans');
                dropCache('stock:scope');
              })
              .catch((e) =>
                Alert.alert('Could not move', e instanceof Error ? e.message : String(e)),
              )
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  };

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }}>
        <SectionCard title="Technician">
          <Text style={{ color: colors.red }}>{error}</Text>
        </SectionCard>
      </View>
    );
  }
  if (!detail) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.navy} />
      </View>
    );
  }
  if (!detail.allowed) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }}>
        <SectionCard title="Technician">
          <Text style={{ color: colors.muted }}>This technician is not in your team.</Text>
        </SectionCard>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}
    >
      <SectionCard title={detail.technicianName ?? detail.staffCode ?? 'Technician'}>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
          <Badge
            text={detail.rosterStatus === 'former' ? 'Former' : 'Current'}
            tone={detail.rosterStatus === 'former' ? 'warn' : 'ok'}
          />
          {detail.vanStatus === 'no_van' ? <Badge text="No van" tone="muted" /> : null}
        </View>
        <Row label="Staff code" value={detail.staffCode ?? ''} />
        {detail.email ? <Row label="Email" value={detail.email} /> : null}
        <Row label="Reports to" value={detail.managerName ?? 'Unallocated'} />
        {detail.allocationUpdatedAt ? (
          <Row
            label="Allocated"
            value={`${detail.allocationUpdatedAt.slice(0, 16).replace('T', ' ')}${
              detail.allocationUpdatedBy ? `, by ${detail.allocationUpdatedBy}` : ''
            }`}
          />
        ) : null}
      </SectionCard>

      <SectionCard title="Van">
        {detail.vanStatus === 'no_van' ? (
          <Text style={{ color: colors.muted }}>
            Confirmed as holding no van stock. Not a fault.
          </Text>
        ) : detail.vanCode ? (
          <>
            <Row label="Van" value={detail.vanDescription ?? detail.vanCode} />
            <Row
              label="Stock"
              value={`${detail.inStock ?? 0} in stock of ${detail.carried ?? 0} lines carried`}
            />
            <Button
              title="Open van stock"
              onPress={() =>
                router.push({
                  pathname: '/van/[staff]',
                  params: {
                    staff: detail.staffCode!,
                    name: detail.technicianName ?? detail.staffCode!,
                  },
                })
              }
            />
          </>
        ) : (
          <Text style={{ color: colors.muted }}>No van is recorded for this technician.</Text>
        )}
      </SectionCard>

      {role === 'admin' ? (
        <SectionCard title="Allocation">
          {moving ? (
            <>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 8 }}>
                Choose the manager this technician reports to.
              </Text>
              {targets.map((t) => (
                <Pressable
                  key={t.email}
                  onPress={() => !busy && move(t.email, t.name)}
                  accessibilityRole="button"
                  accessibilityLabel={`Allocate to ${t.name}`}
                  style={{
                    paddingVertical: 10,
                    borderTopWidth: 1,
                    borderTopColor: colors.line,
                    opacity: busy ? 0.5 : 1,
                  }}
                >
                  <Text
                    style={{
                      color:
                        t.email === detail.managerEmail ? colors.greenText : colors.ink,
                      fontFamily:
                        t.email === detail.managerEmail ? fonts.bodyMedium : undefined,
                      fontSize: 14,
                    }}
                  >
                    {t.email === detail.managerEmail ? '✓ ' : ''}
                    {t.name}
                  </Text>
                </Pressable>
              ))}
              <Button title="Cancel" kind="secondary" onPress={() => setMoving(false)} />
            </>
          ) : (
            <Button title="Move to another manager" onPress={() => setMoving(true)} />
          )}
        </SectionCard>
      ) : null}
    </ScrollView>
  );
}

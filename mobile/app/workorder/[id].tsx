import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  addDispenser,
  DispenserResolved,
  getWorkOrder,
  retireDispenser,
  WorkOrderBundle,
} from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { fetchThrough, writeCache } from '../../src/db/cache';
import { Badge, Button, SectionCard, colors } from '../../src/components/ui';
import { FormScrollView } from '../../src/components/FormScrollView';

export default function WorkOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { accessToken } = useAuth();
  const [bundle, setBundle] = useState<WorkOrderBundle | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ make: 'Tatsuno', model: '', serialNumber: '', saApprovalNumber: '' });

  const load = useCallback(async () => {
    try {
      const b = await fetchThrough(`workorder:${id}`, () => getWorkOrder(accessToken, id));
      setBundle(b);
    } catch (err) {
      Alert.alert('Could not load work order', err instanceof Error ? err.message : String(err));
    }
  }, [accessToken, id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!bundle) return <Text style={{ padding: 16 }}>Loading…</Text>;

  const active = bundle.dispensers.filter((d) => d.status !== 'retired');
  const retired = bundle.dispensers.filter((d) => d.status === 'retired');

  const refreshBundle = async () => {
    const b = await getWorkOrder(accessToken, id);
    writeCache(`workorder:${id}`, b);
    setBundle(b);
  };

  const retire = (d: DispenserResolved) => {
    Alert.alert('Retire dispenser', `Retire ${d.serialNumber || d.id}? It stays on issued certificates but drops off the active list.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Retire',
        style: 'destructive',
        onPress: async () => {
          try {
            await retireDispenser(accessToken, d.id);
            await refreshBundle();
          } catch (err) {
            Alert.alert('Could not retire', err instanceof Error ? err.message : String(err));
          }
        },
      },
    ]);
  };

  const submitAdd = async () => {
    if (!form.model || !form.serialNumber || !form.saApprovalNumber) {
      Alert.alert('Missing details', 'Make, model, serial number and SA approval number are required.');
      return;
    }
    setBusy(true);
    try {
      await addDispenser(accessToken, { siteId: bundle.workOrder.siteId, ...form });
      setForm({ make: 'Tatsuno', model: '', serialNumber: '', saApprovalNumber: '' });
      setAdding(false);
      await refreshBundle();
    } catch (err) {
      Alert.alert('Could not add dispenser', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = (d: DispenserResolved) =>
    router.push({
      pathname: '/dispenser/[id]/identity',
      params: { id: d.id, workOrderId: id, siteId: bundle.workOrder.siteId },
    });

  const site = bundle.site;
  const siteIncomplete = !site || !site.address || !site.customerName || !site.siteName;

  return (
    <FormScrollView>
      <SectionCard title={`Work order ${bundle.workOrder.reference}`}>
        <Text style={{ color: colors.ink, fontWeight: '600' }}>
          {site?.customerName ?? '—'} · {site?.siteName ?? '—'}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{site?.address ?? 'Address not set'}</Text>
        {site?.telephone ? <Text style={{ color: colors.muted, fontSize: 13 }}>Tel: {site.telephone}</Text> : null}
        {siteIncomplete ? (
          <Text style={{ color: colors.amber, fontSize: 12, marginTop: 4 }}>
            Site details are incomplete — you can complete them when verifying a dispenser.
          </Text>
        ) : null}
      </SectionCard>

      <SectionCard title="Dispensers to verify">
        {active.length === 0 ? (
          <Text style={{ color: colors.muted }}>No active dispensers. Add one below.</Text>
        ) : (
          active.map((d) => (
            <View
              key={d.id}
              style={{ borderTopWidth: 1, borderColor: colors.line, paddingVertical: 8 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '600', color: colors.ink }}>
                    {d.make || 'Unknown'} {d.model} {d.serialNumber ? `· ${d.serialNumber}` : ''}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {d.id} · {d.source}
                    {!d.serialNumber ? ' · identity incomplete' : ''}
                  </Text>
                </View>
                {d.source === 'manual' ? <Badge text="added" tone="muted" /> : null}
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                <View style={{ flex: 1 }}>
                  <Button title="Verify" onPress={() => verify(d)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Retire" kind="danger" onPress={() => retire(d)} />
                </View>
              </View>
            </View>
          ))
        )}

        {adding ? (
          <View style={{ marginTop: 10 }}>
            {(['make', 'model', 'serialNumber', 'saApprovalNumber'] as const).map((f) => (
              <View key={f} style={{ marginBottom: 6 }}>
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 3 }}>
                  {ADD_FIELD_LABELS[f]}
                </Text>
                <TextInput
                  style={inputStyle}
                  placeholder={ADD_FIELD_LABELS[f]}
                  value={form[f]}
                  onChangeText={(t) => setForm((prev) => ({ ...prev, [f]: t }))}
                />
              </View>
            ))}
            <Button title="Save dispenser" onPress={submitAdd} busy={busy} />
            <Button title="Cancel" kind="secondary" onPress={() => setAdding(false)} />
          </View>
        ) : (
          <Button title="Add a dispenser" kind="secondary" onPress={() => setAdding(true)} />
        )}
      </SectionCard>

      {retired.length > 0 ? (
        <SectionCard title="Retired dispensers">
          {retired.map((d) => (
            <Text key={d.id} style={{ color: colors.muted, fontSize: 13, paddingVertical: 2 }}>
              {d.make} {d.model} · {d.serialNumber} (retired {d.retiredAt?.slice(0, 10) ?? ''})
            </Text>
          ))}
        </SectionCard>
      ) : null}
    </FormScrollView>
  );
}

const ADD_FIELD_LABELS: Record<'make' | 'model' | 'serialNumber' | 'saApprovalNumber', string> = {
  make: 'Make',
  model: 'Model',
  serialNumber: 'Serial number',
  saApprovalNumber: 'SA approval number',
};

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: 6,
  paddingHorizontal: 10,
  paddingVertical: 8,
  marginBottom: 6,
  color: colors.ink,
  backgroundColor: '#fff',
} as const;

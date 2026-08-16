/**
 * Spares booking, on its own page (#162, owner rule). The work order page
 * shows what is booked; this page is where booking happens: the stock
 * pick list (#119), quantities editable in place, and every change saved
 * to the job card as it is made.
 *
 * A technician with no van holds no stock, so nothing recorded here is
 * issued from anywhere (#131). The list stays open and the parts still
 * print: they were fitted, and whose stock they came from is a costing
 * question, not a question about what happened on site.
 */
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  JobCardBundle,
  JobCardPart,
  StockItem,
  getJobCard,
  saveJobCard,
  searchStock,
  stockCount,
} from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { Button, SectionCard, colors, fonts } from '../../src/components/ui';
import { FormScrollView } from '../../src/components/FormScrollView';

const styles = StyleSheet.create({
  numField: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    color: colors.ink,
    backgroundColor: '#fff',
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
});

/** Empty means zero, not NaN. */
const toNum = (s: string): number => {
  const n = Number(String(s).replace(',', '.').trim());
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export default function SparesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { accessToken } = useAuth();

  const [bundle, setBundle] = useState<JobCardBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [parts, setParts] = useState<JobCardPart[]>([]);
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<StockItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [partCount, setPartCount] = useState<number | null>(null);
  const dirty = React.useRef(false);

  const load = useCallback(() => {
    getJobCard(accessToken, String(id), {
      onFresh: (fresh) => {
        setBundle(fresh);
        if (!dirty.current) setParts(fresh.jobCard?.parts ?? []);
      },
    })
      .then((b) => {
        setBundle(b);
        if (!dirty.current) setParts(b.jobCard?.parts ?? []);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, [accessToken, id]);

  useFocusEffect(useCallback(() => load(), [load]));

  // The register loads with nothing typed, so the field is a PICK LIST and
  // not a guessing game (#119). Debounced for forecourt signal.
  React.useEffect(() => {
    const q = search.trim();
    setSearching(true);
    let live = true;
    const timer = setTimeout(
      () => {
        searchStock(accessToken, q)
          .then((r) => live && setHits(r))
          .catch(() => live && setHits([]))
          .finally(() => live && setSearching(false));
      },
      q ? 250 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search, accessToken]);

  React.useEffect(() => {
    stockCount(accessToken)
      .then(setPartCount)
      .catch(() => {});
  }, [accessToken]);

  const persist = (next: JobCardPart[]) => {
    void saveJobCard(accessToken, String(id), {
      visits: bundle?.jobCard?.visits ?? [],
      parts: next,
      workPerformed: bundle?.jobCard?.workPerformed ?? '',
    }).catch(() => {});
  };

  /** Adding the same part twice bumps the quantity rather than making a
   * second line: two lines for one item is a costing sheet nobody can
   * check against the van. */
  const addPart = (hit: StockItem) => {
    dirty.current = true;
    const at = parts.findIndex((p) => p.itemCode === hit.itemCode);
    const next =
      at >= 0
        ? parts.map((p, i) => (i === at ? { ...p, quantity: p.quantity + 1 } : p))
        : [
            ...parts,
            {
              itemCode: hit.itemCode,
              description: hit.description ?? hit.itemCode,
              quantity: 1,
              unit: hit.unit,
            },
          ];
    setParts(next);
    setSearch('');
    setHits([]);
    persist(next);
  };

  if (loadError) {
    return (
      <FormScrollView>
        <SectionCard title="Could not open the spares">
          <Text style={{ color: colors.ink, fontSize: 14 }}>{loadError}</Text>
          <Button title="Try again" onPress={load} />
          <Button title="Go back" kind="secondary" onPress={() => router.back()} />
        </SectionCard>
      </FormScrollView>
    );
  }
  if (!bundle) return <Text style={{ padding: 16, color: colors.muted }}>Loading…</Text>;

  const signed = bundle.jobCard?.state === 'signed';

  return (
    <FormScrollView>
      <SectionCard title={bundle.workOrderCode ?? 'Spares'}>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{bundle.siteName}</Text>
        {signed ? (
          <Text style={{ color: colors.amber, fontSize: 12, marginTop: 6 }}>
            The job card is signed, so the spares cannot change.
          </Text>
        ) : null}
        {bundle.costingNote ? (
          <Text style={{ color: colors.amber, fontSize: 12, marginTop: 6 }}>{bundle.costingNote}</Text>
        ) : null}
      </SectionCard>

      <SectionCard title="Booked on this job">
        {parts.map((p, i) => (
          <View
            key={`${p.itemCode}-${i}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink, fontSize: 13, fontFamily: fonts.mono }}>
                {p.itemCode}
              </Text>
              {p.description && p.description !== p.itemCode ? (
                <Text style={{ color: colors.muted, fontSize: 11 }}>{p.description}</Text>
              ) : null}
            </View>
            {signed ? (
              <Text style={{ color: colors.ink, fontSize: 13 }}>
                {p.quantity} {p.unit}
              </Text>
            ) : (
              <>
                {/* Quantity is editable in place. A technician who fitted
                    two of something should not have to remove the line and
                    find the part again. */}
                <TextInput
                  style={[styles.numField, { width: 64, textAlign: 'right' }]}
                  value={String(p.quantity)}
                  onChangeText={(v) => {
                    dirty.current = true;
                    setParts((prev) => prev.map((q, j) => (j === i ? { ...q, quantity: toNum(v) } : q)));
                  }}
                  onBlur={() => persist(parts)}
                  keyboardType="decimal-pad"
                  accessibilityLabel={`Quantity of ${p.itemCode}`}
                />
                <Text style={{ color: colors.muted, fontSize: 11, width: 22 }}>{p.unit}</Text>
                <Text
                  onPress={() => {
                    dirty.current = true;
                    const next = parts.filter((_, j) => j !== i);
                    setParts(next);
                    persist(next);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${p.itemCode}`}
                  style={{ color: colors.red, fontSize: 13, paddingHorizontal: 6 }}
                >
                  &#10007;
                </Text>
              </>
            )}
          </View>
        ))}
        {parts.length === 0 ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>No spares booked.</Text>
        ) : null}
      </SectionCard>

      {!signed ? (
        <SectionCard title="Add from the stock register">
          <TextInput
            style={styles.numField}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            placeholder="Search a part by code or name"
            accessibilityLabel="Search parts"
          />
          {searching ? (
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>Searching…</Text>
          ) : (
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
              {search.trim()
                ? `${hits.length} of ${partCount ?? '?'} parts`
                : `${partCount ?? hits.length} parts, most carried first`}
            </Text>
          )}
          <ScrollView style={{ maxHeight: 320 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {hits.map((h) => (
              <Text
                key={h.itemCode}
                onPress={() => addPart(h)}
                accessibilityRole="button"
                accessibilityLabel={`Add ${h.itemCode} ${h.description ?? ''}`}
                style={{
                  color: colors.ink,
                  fontSize: 13,
                  paddingVertical: 7,
                  borderTopWidth: 1,
                  borderTopColor: colors.line,
                }}
              >
                <Text style={{ fontFamily: fonts.mono }}>{h.itemCode}</Text>
                {'  '}
                {h.description}
                {h.vanCount > 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    {'  '}on {h.vanCount} {h.vanCount === 1 ? 'van' : 'vans'}
                  </Text>
                ) : null}
              </Text>
            ))}
          </ScrollView>
          {!searching && hits.length === 0 ? (
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>
              {search.trim()
                ? `No match in ${partCount ?? 'the'} parts. Parts come from the stock register, so a code that is not listed cannot be booked to the work order.`
                : 'The parts register is empty on this device. Reconnect once to load it.'}
            </Text>
          ) : null}
        </SectionCard>
      ) : null}

      <View style={{ marginHorizontal: 12 }}>
        <Button title="Done" onPress={() => router.back()} />
      </View>
    </FormScrollView>
  );
}

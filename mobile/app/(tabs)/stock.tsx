/**
 * Stock tab (#138): what is on my van, or on my technicians' vans.
 *
 * The question this answers is not "can I book this part", which the job
 * card's picker already answers. It is "what have I got", which gets asked
 * in a yard before driving out, not on a forecourt mid-job. Different
 * question, different screen.
 *
 * Reads the offline mirror first like every other screen here, because the
 * yard is exactly where the signal is not.
 */
import { Redirect, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  StockScope,
  TeamVan,
  VanStock,
  getStockScope,
  getTeamVans,
  getVanStock,
} from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { GreetingHeader } from '../../src/components/GreetingHeader';
import { SyncBanner } from '../../src/components/SyncBanner';
import { SectionCard, colors, fonts } from '../../src/components/ui';

/** A snapshot of somebody else's system needs a date on it. Without one,
 * a quantity invites a technician to drive to a depot on a figure that
 * could be a week old. */
function freshness(at: string | null | undefined): string {
  if (!at) return 'Stock has not been loaded from Syspro yet';
  const then = new Date(at).getTime();
  if (Number.isNaN(then)) return 'Stock last loaded from Syspro at an unknown time';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `Stock from Syspro, ${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Stock from Syspro, ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `Stock from Syspro, ${days} day${days === 1 ? '' : 's'} ago`;
}

function Quantity({ quantity, unit }: { quantity: number; unit: string }) {
  const has = quantity > 0;
  return (
    <View
      style={{
        minWidth: 62,
        alignItems: 'flex-end',
      }}
    >
      <Text
        style={{
          fontSize: 16,
          fontFamily: fonts.bodyMedium,
          fontVariant: ['tabular-nums'],
          color: has ? colors.ink : colors.muted,
        }}
      >
        {Number.isInteger(quantity) ? quantity : quantity.toFixed(2)}
      </Text>
      <Text style={{ fontSize: 11, color: colors.muted }}>{unit}</Text>
    </View>
  );
}

function StockLines({ stock }: { stock: VanStock }) {
  if (stock.vanStatus === 'no_van') {
    // A statement, not an empty list. Confirmed as holding no stock is a
    // normal situation and not a fault (#131), and an empty list would
    // read as one.
    return <Text style={{ color: colors.muted }}>{stock.reason}</Text>;
  }
  if (!stock.items.length) {
    return (
      <Text style={{ color: colors.muted }}>
        {stock.reason ?? 'Nothing matches that on this van'}
      </Text>
    );
  }
  return (
    <View>
      {stock.items.map((line, index) => (
        <View
          key={line.itemCode}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 9,
            borderTopWidth: index === 0 ? 0 : 1,
            borderTopColor: colors.line,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.bodyMedium, color: colors.ink }}>{line.itemCode}</Text>
            {line.description ? (
              <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={2}>
                {line.description}
              </Text>
            ) : null}
          </View>
          <Quantity quantity={line.quantity} unit={line.unit} />
        </View>
      ))}
    </View>
  );
}

export default function StockTab() {
  const { identity, accessToken, loading } = useAuth();
  const token = accessToken;

  const [scope, setScope] = useState<StockScope | null>(null);
  const [vans, setVans] = useState<TeamVan[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [stock, setStock] = useState<VanStock | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (staffCode: string | null, q: string) => {
      setBusy(true);
      setError(null);
      try {
        const [nextScope, nextVans, nextStock] = await Promise.all([
          getStockScope(token),
          getTeamVans(token),
          getVanStock(token, staffCode, q),
        ]);
        setScope(nextScope);
        setVans(nextVans);
        setStock(nextStock);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load stock');
      } finally {
        setBusy(false);
      }
    },
    [token],
  );

  useFocusEffect(
    useCallback(() => {
      void load(selected, query);
      // Intentionally not re-running on every keystroke: the search box
      // calls load itself on submit.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, selected]),
  );

  const isTeam = useMemo(
    () => scope?.mode === 'team' || scope?.mode === 'all',
    [scope],
  );

  if (loading) return null;
  if (!identity) return <Redirect href="/" />;

  const activeVan = vans.find((v) => v.staffCode === (selected ?? stock?.staffCode));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <GreetingHeader title="Stock" />
      <SyncBanner />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 12 }}>
        {error ? (
          <SectionCard title="Stock">
            <Text style={{ color: colors.red }}>{error}</Text>
          </SectionCard>
        ) : null}

        <SectionCard
          title={
            isTeam
              ? 'My technicians'
              : activeVan?.vanDescription ?? scope?.vanDescription ?? 'My van'
          }
        >
          <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 8 }}>
            {freshness(stock?.lastLoadedAt ?? scope?.lastLoadedAt)}
          </Text>
          {scope?.reason ? (
            <Text style={{ fontSize: 12, color: colors.muted }}>{scope.reason}</Text>
          ) : null}
        </SectionCard>

        {isTeam ? (
          <SectionCard title="Vans">
            {vans.length === 0 ? (
              <Text style={{ color: colors.muted }}>
                {scope?.reason ?? 'No technicians are allocated to you yet'}
              </Text>
            ) : (
              vans.map((van) => {
                const active = van.staffCode === (selected ?? stock?.staffCode);
                return (
                  <Pressable
                    key={van.staffCode}
                    onPress={() => setSelected(van.staffCode)}
                    accessibilityLabel={`Show stock for ${van.technicianName ?? van.staffCode}`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      paddingVertical: 10,
                      paddingHorizontal: 10,
                      borderRadius: 10,
                      backgroundColor: active ? colors.greenTint : 'transparent',
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: fonts.bodyMedium, color: colors.ink }}>
                        {van.technicianName ?? van.staffCode}
                      </Text>
                      <Text style={{ fontSize: 12, color: colors.muted }}>
                        {van.vanStatus === 'no_van'
                          ? 'Holds no van stock'
                          : van.vanDescription ?? van.vanCode ?? 'Van not set'}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text
                        style={{
                          fontFamily: fonts.bodyMedium,
                          fontVariant: ['tabular-nums'],
                          color: colors.ink,
                        }}
                      >
                        {van.inStock}
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.muted }}>in stock</Text>
                    </View>
                  </Pressable>
                );
              })
            )}
          </SectionCard>
        ) : null}

        <SectionCard
          title={
            isTeam && activeVan
              ? `${activeVan.technicianName ?? activeVan.staffCode}: stock`
              : 'On board'
          }
        >
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void load(selected, query)}
            placeholder="Search a part code or description"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Search this van's stock"
            style={{
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: 10,
              paddingHorizontal: 10,
              paddingVertical: 9,
              color: colors.ink,
              backgroundColor: '#fff',
              marginBottom: 10,
            }}
          />
          {busy && !stock ? (
            <ActivityIndicator color={colors.navy} />
          ) : stock ? (
            <StockLines stock={stock} />
          ) : (
            <Text style={{ color: colors.muted }}>Nothing loaded yet</Text>
          )}
        </SectionCard>
      </ScrollView>
    </View>
  );
}

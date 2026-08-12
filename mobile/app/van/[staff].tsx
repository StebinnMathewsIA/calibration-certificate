/**
 * One van's stock, on its own screen (#145).
 *
 * Reached from the stock tab's grouped list. Authorisation lives in
 * app_van_stock, which refuses a caller not entitled to this technician's
 * van, so the route can be opened by anyone and still show only what the
 * caller may see. The refusal is shown, not masked as an empty van.
 */
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';
import { VanStock, getVanStock } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { SectionCard, colors, fonts } from '../../src/components/ui';

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

export default function VanStockScreen() {
  const { staff, name } = useLocalSearchParams<{ staff: string; name?: string }>();
  const { accessToken } = useAuth();

  const [stock, setStock] = useState<VanStock | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (q: string) => {
      setError(null);
      getVanStock(accessToken, String(staff), q)
        .then(setStock)
        .catch((e) => setError(e instanceof Error ? e.message : 'Could not load this van'));
    },
    [accessToken, staff],
  );

  React.useEffect(() => {
    load('');
  }, [load]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}
    >
      <SectionCard title={String(name ?? stock?.vanDescription ?? 'Van stock')}>
        <Text style={{ fontSize: 12, color: colors.muted }}>
          {stock?.vanDescription ?? ''}
          {stock?.vanCode ? ` (${stock.vanCode})` : ''}
        </Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
          {freshness(stock?.lastLoadedAt)}
        </Text>
      </SectionCard>

      <SectionCard title="On board">
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => load(query)}
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
        {error ? (
          <Text style={{ color: colors.red }}>{error}</Text>
        ) : stock === null ? (
          <ActivityIndicator color={colors.navy} />
        ) : !stock.allowed ? (
          <Text style={{ color: colors.muted }}>
            {stock.reason ?? 'This van is not yours to view.'}
          </Text>
        ) : stock.vanStatus === 'no_van' ? (
          <Text style={{ color: colors.muted }}>{stock.reason}</Text>
        ) : stock.items.length === 0 ? (
          <Text style={{ color: colors.muted }}>
            {stock.reason ?? 'Nothing matches that on this van'}
          </Text>
        ) : (
          stock.items.map((line, index) => (
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
                <Text style={{ fontFamily: fonts.bodyMedium, color: colors.ink }}>
                  {line.itemCode}
                </Text>
                {line.description ? (
                  <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={2}>
                    {line.description}
                  </Text>
                ) : null}
              </View>
              <View style={{ minWidth: 62, alignItems: 'flex-end' }}>
                <Text
                  style={{
                    fontSize: 16,
                    fontFamily: fonts.bodyMedium,
                    fontVariant: ['tabular-nums'],
                    color: line.quantity > 0 ? colors.ink : colors.muted,
                  }}
                >
                  {Number.isInteger(line.quantity) ? line.quantity : line.quantity.toFixed(2)}
                </Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>{line.unit}</Text>
              </View>
            </View>
          ))
        )}
      </SectionCard>
    </ScrollView>
  );
}

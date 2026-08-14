/**
 * Stock tab (#138, reshaped by #145): what is on my van, or on my
 * technicians' vans.
 *
 * The question this answers is not "can I book this part", which the job
 * card's picker already answers. It is "what have I got", which gets asked
 * in a yard before driving out, not on a forecourt mid-job.
 *
 * Owner reshape from device testing (#145): the freshness and the role
 * scope live on one slim line under the header, outside any card. A
 * technician still gets their own van inline, because their stock IS the
 * tab. A manager or admin gets one collapsible section per manager, since
 * eighty vans in six named groups are legible where eighty in a row are
 * not, and tapping a van opens its stock on its OWN screen instead of an
 * inline section somewhere below the fleet.
 */
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  AllocationManager,
  StockScope,
  VanStock,
  getAllocationTree,
  getStockScope,
  getVanStock,
} from '../../src/api/client';
import { ManagerTree } from '../../src/components/ManagerTree';
import { TreeBoundary } from '../../src/components/TreeBoundary';
import { useAuth } from '../../src/auth/AuthContext';
import { GreetingHeader } from '../../src/components/GreetingHeader';
import { SyncBanner } from '../../src/components/SyncBanner';
import { SectionCard, colors, fonts } from '../../src/components/ui';
import { onFreshnessSettled } from '../../src/sync/freshness';

/** A snapshot of somebody else's system needs a date on it. Without one,
 * a quantity invites a technician to drive to a depot on a figure that
 * could be a week old. */
function freshness(at: string | null | undefined): string {
  if (!at) return 'Not loaded from Syspro yet';
  const then = new Date(at).getTime();
  if (Number.isNaN(then)) return 'Last Syspro load time unknown';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `Syspro, ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Syspro, ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `Syspro, ${days} day${days === 1 ? '' : 's'} ago`;
}

function Quantity({ quantity, unit }: { quantity: number; unit: string }) {
  const has = quantity > 0;
  return (
    <View style={{ minWidth: 62, alignItems: 'flex-end' }}>
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

/** Chevron for the collapsible manager headers, in the brand line style. */
function Chevron({ open }: { open: boolean }) {
  return (
    <Text style={{ fontSize: 12, color: colors.muted }}>{open ? '▴' : '▾'}</Text>
  );
}

function TechnicianOwnVan({
  stock,
  query,
  setQuery,
  onSearch,
  busy,
}: {
  stock: VanStock | null;
  query: string;
  setQuery: (q: string) => void;
  onSearch: () => void;
  busy: boolean;
}) {
  return (
    <SectionCard title="On board">
      <TextInput
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={onSearch}
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
      ) : stock == null ? (
        <Text style={{ color: colors.muted }}>Nothing loaded yet</Text>
      ) : stock.vanStatus === 'no_van' ? (
        // A statement, not an empty list. Confirmed as holding no stock is
        // a normal situation and not a fault (#131).
        <Text style={{ color: colors.muted }}>{stock.reason}</Text>
      ) : !stock.items.length ? (
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
            <Quantity quantity={line.quantity} unit={line.unit} />
          </View>
        ))
      )}
    </SectionCard>
  );
}

export default function StockTab() {
  const { identity, accessToken, loading } = useAuth();
  const router = useRouter();

  const [scope, setScope] = useState<StockScope | null>(null);
  const [tree, setTree] = useState<AllocationManager[]>([]);
  const [stock, setStock] = useState<VanStock | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(
    async (q: string) => {
      setBusy(true);
      setError(null);
      try {
        const nextScope = await getStockScope(accessToken);
        setScope(nextScope);
        if (nextScope.mode === 'team' || nextScope.mode === 'all') {
          setTree(await getAllocationTree(accessToken));
        } else {
          setStock(await getVanStock(accessToken, null, q));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load stock');
      } finally {
        setBusy(false);
      }
    },
    [accessToken],
  );

  useFocusEffect(
    useCallback(() => {
      void load(query);
      // The search box triggers load itself on submit; refetching per
      // keystroke would hammer the RPC for nothing.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  // Repaint from the caches the freshness gate (#150) just refreshed:
  // foregrounding onto this tab fires no focus event.
  useEffect(() => onFreshnessSettled(() => void load('')), [load]);

  const isTeam = scope?.mode === 'team' || scope?.mode === 'all';

  if (loading) return null;
  if (!identity) return <Redirect href="/" />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <GreetingHeader title="Stock" />
      <SyncBanner />
      {/* The meta line (#145): role scope left, freshness right, outside
          any card. Context, not content, so it does not spend a card. */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: 18,
          paddingBottom: 6,
          gap: 12,
        }}
      >
        <Text style={{ flex: 1, fontSize: 12, color: colors.muted }} numberOfLines={1}>
          {scope?.reason ?? ''}
        </Text>
        <Text style={{ fontSize: 12, color: colors.muted }}>
          {freshness(stock?.lastLoadedAt ?? scope?.lastLoadedAt)}
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 120, gap: 12 }}>
        {error ? (
          <SectionCard title="Stock">
            <Text style={{ color: colors.red }}>{error}</Text>
          </SectionCard>
        ) : null}

        {!isTeam ? (
          <TechnicianOwnVan
            stock={stock}
            query={query}
            setQuery={setQuery}
            onSearch={() => void load(query)}
            busy={busy}
          />
        ) : busy && tree.length === 0 ? (
          <SectionCard title="Vans">
            <ActivityIndicator color={colors.navy} />
          </SectionCard>
        ) : tree.length === 0 ? (
          <SectionCard title="Vans">
            <Text style={{ color: colors.muted }}>
              {scope?.reason ?? 'No technicians are allocated to you yet'}
            </Text>
          </SectionCard>
        ) : (
          <SectionCard title="Teams">
            {/* The whole reporting chain, nested (#147). Managers render
                at their level van or no van, because the hierarchy is
                structure, not stock; each manager's technicians expand
                beneath them. */}
            <TreeBoundary>
            <ManagerTree
              managers={tree}
              showStock
              onTechnicianPress={(tech) =>
                router.push({
                  pathname: '/van/[staff]',
                  params: {
                    staff: tech.staffCode,
                    name: tech.technicianName ?? tech.staffCode,
                  },
                })
              }
            />
            </TreeBoundary>
          </SectionCard>
        )}
      </ScrollView>
    </View>
  );
}

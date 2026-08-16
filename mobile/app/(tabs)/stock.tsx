/**
 * Stock tab (#138, reshaped by #145, restyled by #169): what is on my
 * van, or on my technicians' vans.
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
 *
 * The dress is the Home card language (#169): headings outside the
 * cards, rounded white cards, the disc motif, the shared search field.
 */
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
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
import { colors, fonts } from '../../src/components/ui';
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

/** The van, in the brand's hand-drawn line style, on a navy disc. */
function VanDisc() {
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 999,
        backgroundColor: colors.navy,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
        <Path
          d="M2.5 15.5V8.5a1.5 1.5 0 0 1 1.5-1.5h8.5v8.5"
          stroke="#fff"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d="M12.5 9.5h3.6l3.4 3.4v2.6"
          stroke="#fff"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Line x1={2.5} y1={15.5} x2={21.5} y2={15.5} stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
        <Circle cx={7.5} cy={17.5} r={2} stroke="#fff" strokeWidth={1.8} />
        <Circle cx={16.5} cy={17.5} r={2} stroke="#fff" strokeWidth={1.8} />
      </Svg>
    </View>
  );
}

/** Section heading outside the card, Home style. */
function Heading({ text }: { text: string }) {
  return (
    <Text
      style={{
        marginTop: 4,
        marginBottom: 8,
        fontFamily: fonts.heading,
        color: colors.ink,
        fontSize: 18,
      }}
    >
      {text}
    </Text>
  );
}

const cardStyle = {
  backgroundColor: '#fff',
  borderRadius: 16,
  borderWidth: 1,
  borderColor: colors.line,
  padding: 12,
} as const;

function Quantity({ quantity, unit }: { quantity: number; unit: string }) {
  const has = quantity > 0;
  return (
    <View style={{ minWidth: 62, alignItems: 'flex-end' }}>
      <Text
        style={{
          fontSize: 16,
          fontFamily: fonts.heading,
          fontVariant: ['tabular-nums'],
          color: has ? colors.ink : colors.muted,
        }}
      >
        {Number.isInteger(quantity) ? quantity : quantity.toFixed(2)}
      </Text>
      <Text style={{ fontSize: 10.5, color: colors.muted }}>{unit}</Text>
    </View>
  );
}

function TechnicianOwnVan({
  stock,
  scopeReason,
  query,
  setQuery,
  onSearch,
  busy,
}: {
  stock: VanStock | null;
  scopeReason: string | null;
  query: string;
  setQuery: (q: string) => void;
  onSearch: () => void;
  busy: boolean;
}) {
  return (
    <View>
      <Heading text="On board" />
      <View style={cardStyle}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <VanDisc />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.heading, fontSize: 14.5, color: colors.ink }}>
              Your van
            </Text>
            {scopeReason ? (
              <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
                {scopeReason}
              </Text>
            ) : null}
          </View>
        </View>
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
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 9,
            fontSize: 14,
            color: colors.ink,
            backgroundColor: '#fff',
            marginBottom: 6,
          }}
        />
        {busy && !stock ? (
          <ActivityIndicator color={colors.navy} style={{ marginVertical: 10 }} />
        ) : stock == null ? (
          <Text style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>Nothing loaded yet</Text>
        ) : stock.vanStatus === 'no_van' ? (
          // A statement, not an empty list. Confirmed as holding no stock is
          // a normal situation and not a fault (#131).
          <Text style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>{stock.reason}</Text>
        ) : !stock.items.length ? (
          <Text style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>
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
                <Text style={{ fontFamily: fonts.mono, fontSize: 13, color: colors.ink }}>
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
      </View>
    </View>
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
          {isTeam ? (scope?.reason ?? '') : ''}
        </Text>
        <Text style={{ fontSize: 12, color: colors.muted }}>
          {freshness(stock?.lastLoadedAt ?? scope?.lastLoadedAt)}
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 12, paddingTop: 4, paddingBottom: 120, gap: 12 }}>
        {error ? (
          <View style={cardStyle}>
            <Text style={{ color: colors.red, fontSize: 13 }}>{error}</Text>
          </View>
        ) : null}

        {!isTeam ? (
          <TechnicianOwnVan
            stock={stock}
            scopeReason={scope?.reason ?? null}
            query={query}
            setQuery={setQuery}
            onSearch={() => void load(query)}
            busy={busy}
          />
        ) : busy && tree.length === 0 ? (
          <View>
            <Heading text="Vans" />
            <View style={cardStyle}>
              <ActivityIndicator color={colors.navy} />
            </View>
          </View>
        ) : tree.length === 0 ? (
          <View>
            <Heading text="Vans" />
            <View style={cardStyle}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>
                {scope?.reason ?? 'No technicians are allocated to you yet'}
              </Text>
            </View>
          </View>
        ) : (
          <View>
            <Heading text="Teams" />
            <View style={cardStyle}>
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
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

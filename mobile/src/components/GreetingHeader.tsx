/**
 * Home greeting header (#32): "Hello, {first name}" with the open
 * work-order count as the subtitle and the profile avatar on the right.
 * Rendered in-content on the screen background — the Home tab hides the
 * navy wordmark bar in favour of this.
 */
import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { getProfile, TechProfile } from '../profile/profileStore';
import { RefreshIcon } from './BrandHeader';
import { colors, fonts } from './ui';
import { HeaderProfileButton } from './HeaderProfileButton';

/** The name we greet with: profile first name, else the first real word of
 * the display/sign-in name (skipping initials like "S."), else "there". */
function greetingName(profile: TechProfile, identityName: string): string {
  if (profile.firstName?.trim()) return profile.firstName.trim().split(/\s+/)[0];
  const words = (profile.displayName || identityName || '')
    .split(/\s+/)
    .filter((w) => Boolean(w) && !w.includes('@'));
  return words.find((w) => !w.endsWith('.')) ?? words[0] ?? 'there';
}

export function GreetingHeader({
  openWorkOrders,
  checking,
  onRefresh,
  refreshing,
}: {
  openWorkOrders: number;
  /** True while the first refresh is still in flight (nothing cached yet). */
  checking: boolean;
  /** Header refresh action (#39) — the icon button left of the avatar. */
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { identity } = useAuth();
  const profile = getProfile(identity?.subject ?? '');

  const subtitle = checking
    ? 'Checking work orders…'
    : openWorkOrders === 0
      ? 'No open work orders'
      : `You have ${openWorkOrders} open work order${openWorkOrders === 1 ? '' : 's'}`;

  return (
    <View
      style={{
        paddingTop: insets.top + 10,
        paddingHorizontal: 16,
        paddingBottom: 4,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.bg,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.heading, fontSize: 28, color: colors.ink }}>
          Hello, {greetingName(profile, identity?.name ?? '')}
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 14, color: colors.muted, marginTop: 2 }}>
          {subtitle}
        </Text>
      </View>
      {onRefresh ? (
        <Pressable
          onPress={onRefresh}
          disabled={refreshing}
          accessibilityRole="button"
          accessibilityLabel="Refresh work orders"
          hitSlop={8}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            marginRight: 10,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.card,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.navy} />
          ) : (
            <RefreshIcon color={colors.navy} />
          )}
        </Pressable>
      ) : null}
      <HeaderProfileButton variant="onLight" />
    </View>
  );
}

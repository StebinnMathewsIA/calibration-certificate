import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { colors } from './ui';
import { getProfile, measuresStatus, profileInitials, profileGaps } from '../profile/profileStore';
import { readCache } from '../db/cache';

/** Two-letter initials from a name. Handles "First Last" -> "FL", a single
 * word -> its first two letters, and an email -> the local part's initials. */
export function initialsOf(name: string): string {
  const cleaned = (name ?? '').trim();
  if (!cleaned) return '?';
  const base = cleaned.includes('@') && !cleaned.includes(' ') ? cleaned.split('@')[0] : cleaned;
  const words = base.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

/** Circular avatar (the technician's initials) in the header, opens profile.
 * `variant` picks the tint: white-on-navy app bars (default) or navy-on-light
 * for in-content headers like the Home greeting. */
export function HeaderProfileButton({ variant = 'onNavy' }: { variant?: 'onNavy' | 'onLight' }) {
  const router = useRouter();
  const { identity } = useAuth();
  // Prefer the profile display name (set from the sign-in details at setup),
  // falling back to the raw sign-in name.
  const profile = getProfile(identity?.subject ?? '');
  const name = profile.displayName || identity?.name || identity?.subject || '';
  // Real first/surname initials when the profile has them; guessed otherwise.
  const initials = profileInitials(profile) ?? initialsOf(name);
  const onLight = variant === 'onLight';
  // Something on the profile is missing and will stop the technician
  // mid-job if they do not fix it (#128). Shown on the avatar because that
  // is the one control on every screen, so the problem is visible long
  // before they are standing in front of a client.
  const gaps = profileGaps(identity?.subject ?? '', readCache);
  // Certified measures ride the same badge (#211): the register lives on
  // the profile and the avatar is the door to it. Red when a gap or a
  // blocking measure problem, amber when a measure merely expires soon.
  const measures = measuresStatus(identity?.subject ?? '');
  const badge = gaps.length > 0 || measures !== null;
  const badgeBlocking = gaps.length > 0 || (measures?.blocking ?? false);
  const spoken = [
    ...gaps,
    ...(measures ? [`Certified measures need attention: ${measures.text}`] : []),
  ];

  return (
    <Pressable
      onPress={() => router.push('/profile')}
      accessibilityRole="button"
      accessibilityLabel={
        spoken.length ? `Open profile. ${spoken.join('. ')}` : 'Open profile'
      }
      hitSlop={8}
      style={{
        width: onLight ? 40 : 34,
        height: onLight ? 40 : 34,
        borderRadius: onLight ? 20 : 17,
        marginRight: onLight ? 0 : 12,
        backgroundColor: onLight ? colors.navy : '#ffffff',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          color: onLight ? '#ffffff' : colors.navy,
          fontWeight: '800',
          fontSize: onLight ? 14 : 13,
        }}
      >
        {initials}
      </Text>
      {badge ? (
        <View
          // A plain typographic mark, not an emoji, per the brand rules.
          // Positioned outside the circle so it reads on both tints.
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: badgeBlocking ? colors.red : colors.amberFill,
            borderWidth: 1.5,
            borderColor: onLight ? '#fff' : colors.navy,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800', lineHeight: 12 }}>!</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { colors } from './ui';
import { getProfile, profileInitials } from '../profile/profileStore';

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

/** Circular avatar (the technician's initials) in the header — opens profile. */
export function HeaderProfileButton() {
  const router = useRouter();
  const { identity } = useAuth();
  // Prefer the profile display name (set from the sign-in details at setup),
  // falling back to the raw sign-in name.
  const profile = getProfile(identity?.subject ?? '');
  const name = profile.displayName || identity?.name || identity?.subject || '';
  // Real first/surname initials when the profile has them; guessed otherwise.
  const initials = profileInitials(profile) ?? initialsOf(name);

  return (
    <Pressable
      onPress={() => router.push('/profile')}
      accessibilityRole="button"
      accessibilityLabel="Open profile"
      hitSlop={8}
      style={{
        width: 34,
        height: 34,
        borderRadius: 17,
        marginRight: 12,
        backgroundColor: '#ffffff',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: colors.navy, fontWeight: '800', fontSize: 13 }}>{initials}</Text>
    </Pressable>
  );
}

import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text } from 'react-native';
import { useAuth } from '../auth/AuthContext';

/** Circular avatar (the user's initial) in the header — opens the profile. */
export function HeaderProfileButton() {
  const router = useRouter();
  const { identity } = useAuth();
  const initial = (identity?.name || identity?.subject || '?').trim().charAt(0).toUpperCase();

  return (
    <Pressable
      onPress={() => router.push('/profile')}
      accessibilityRole="button"
      accessibilityLabel="Open profile"
      hitSlop={8}
      style={{
        width: 32,
        height: 32,
        borderRadius: 16,
        marginRight: 12,
        backgroundColor: '#ffffff',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#1a7a3a', fontWeight: '800', fontSize: 15 }}>{initial}</Text>
    </Pressable>
  );
}

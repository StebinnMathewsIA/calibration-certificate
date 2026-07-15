import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Provider } from '../auth/AuthContext';
import { ProviderLogo } from './ProviderLogo';

const SIZE = 64;
const LOGO = 30;

const LABELS: Record<Provider, string> = {
  microsoft: 'Sign in with Microsoft',
  google: 'Sign in with Google',
  apple: 'Sign in with Apple',
};

// Circle background per brand: white for Microsoft/Google, black for Apple.
const CIRCLE_BG: Record<Provider, string> = {
  microsoft: '#ffffff',
  google: '#ffffff',
  apple: '#000000',
};

/**
 * A circular, icon-only sign-in button. Shows the provider's official mark
 * centred in a round pressable; overlays a spinner while its flow is in
 * flight and dims while another provider is busy.
 */
export function ProviderButton({
  provider,
  onPress,
  busy,
  disabled,
}: {
  provider: Provider;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={LABELS[provider]}
      style={({ pressed }) => [
        styles.circle,
        { backgroundColor: CIRCLE_BG[provider] },
        pressed && !disabled && !busy && styles.pressed,
        disabled && !busy && styles.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={provider === 'apple' ? '#ffffff' : '#5b6b62'} />
      ) : (
        <View style={styles.logoWrap}>
          <ProviderLogo provider={provider} size={LOGO} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d6ded9',
    // subtle elevation so the white circles read against the light screen
    shadowColor: '#16211c',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  logoWrap: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});

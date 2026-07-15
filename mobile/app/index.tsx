import { Redirect } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Image, Text, View } from 'react-native';
import { Provider, useAuth } from '../src/auth/AuthContext';
import { ProviderButton } from '../src/components/ProviderButton';
import { colors, styles } from '../src/components/ui';

const PROVIDERS: Provider[] = ['microsoft', 'google', 'apple'];

export default function SignInScreen() {
  const { identity, loading, signIn } = useAuth();
  const [busy, setBusy] = useState<Provider | null>(null);

  if (!loading && identity) return <Redirect href="/home" />;

  const handle = async (provider: Provider) => {
    setBusy(provider);
    try {
      await signIn(provider);
    } catch (err) {
      Alert.alert('Sign-in failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
      <Image
        source={require('../assets/prowalco-logo.png')}
        style={{ width: 220, height: 80, resizeMode: 'contain', marginBottom: 36 }}
      />
      <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, marginBottom: 6 }}>
        Calibration
      </Text>
      <Text style={{ color: colors.muted, textAlign: 'center', marginBottom: 28 }}>
        Sign in with your work account
      </Text>

      <View style={{ flexDirection: 'row', gap: 22 }}>
        {PROVIDERS.map((provider) => (
          <ProviderButton
            key={provider}
            provider={provider}
            onPress={() => handle(provider)}
            busy={busy === provider}
            disabled={busy !== null && busy !== provider}
          />
        ))}
      </View>
    </View>
  );
}

import * as AppleAuthentication from 'expo-apple-authentication';
import { Redirect } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';
import { Provider, useAuth } from '../src/auth/AuthContext';
import { Button, SectionCard, colors, styles } from '../src/components/ui';

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
    <View style={[styles.screen, { justifyContent: 'center' }]}>
      <SectionCard title="Sign in">
        <Text style={{ color: colors.muted, marginBottom: 10 }}>
          Use your work account. All three options go through Prowalco's identity broker.
        </Text>
        <Button title="Continue with Microsoft" onPress={() => handle('microsoft')} busy={busy === 'microsoft'} />
        <Button title="Continue with Google" onPress={() => handle('google')} busy={busy === 'google'} />
        {Platform.OS === 'ios' ? (
          // Apple's official button + native sheet (App Review expects this on iOS)
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={8}
            style={{ height: 46, marginTop: 8 }}
            onPress={() => handle('apple')}
          />
        ) : (
          // Android: Apple via the web OAuth flow
          <Button title="Continue with Apple" onPress={() => handle('apple')} busy={busy === 'apple'} />
        )}
      </SectionCard>
    </View>
  );
}

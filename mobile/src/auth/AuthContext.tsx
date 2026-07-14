/**
 * Auth via ONE OIDC broker (Auth0 / Cognito / Firebase) that federates
 * Microsoft, Google, and Apple — the app has a single integration and the
 * provider configuration lives in the broker. Tokens are kept in
 * expo-secure-store, never in AsyncStorage.
 */
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { TechnicianIdentity } from '@prowalco/schema';
import { config } from '../config';

WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = 'prowalco.accessToken';
const IDENTITY_KEY = 'prowalco.identity';

export type Provider = 'microsoft' | 'google' | 'apple';

interface AuthState {
  identity: TechnicianIdentity | null;
  accessToken: string | null;
  loading: boolean;
  signIn: (provider: Provider) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Broker-specific hint that preselects the upstream IdP. The values below
 * are Auth0 connection names — adjust once the broker is chosen. */
const PROVIDER_HINTS: Record<Provider, string> = {
  microsoft: 'windowslive',
  google: 'google-oauth2',
  apple: 'apple',
};

function decodeJwtClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<TechnicianIdentity | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const discovery = AuthSession.useAutoDiscovery(config.auth.issuer);
  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'prowalco-cal' });

  useEffect(() => {
    (async () => {
      const [token, storedIdentity] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(IDENTITY_KEY),
      ]);
      if (token && storedIdentity) {
        setAccessToken(token);
        setIdentity(JSON.parse(storedIdentity));
      }
      setLoading(false);
    })();
  }, []);

  const signIn = useCallback(
    async (provider: Provider) => {
      if (!discovery) throw new Error('Auth broker discovery not ready');
      const request = new AuthSession.AuthRequest({
        clientId: config.auth.clientId,
        redirectUri,
        scopes: [...config.auth.scopes],
        usePKCE: true,
        extraParams: { connection: PROVIDER_HINTS[provider] },
      });
      const result = await request.promptAsync(discovery);
      if (result.type !== 'success' || !result.params.code) {
        throw new Error(`Sign-in ${result.type}`);
      }
      const tokens = await AuthSession.exchangeCodeAsync(
        {
          clientId: config.auth.clientId,
          code: result.params.code,
          redirectUri,
          extraParams: { code_verifier: request.codeVerifier ?? '' },
        },
        discovery,
      );
      const claims = decodeJwtClaims(tokens.idToken ?? tokens.accessToken);
      const id: TechnicianIdentity = {
        subject: String(claims.sub ?? ''),
        name: String(claims.name ?? claims.email ?? 'Technician'),
        authMethod: provider,
      };
      await SecureStore.setItemAsync(TOKEN_KEY, tokens.accessToken);
      await SecureStore.setItemAsync(IDENTITY_KEY, JSON.stringify(id));
      setAccessToken(tokens.accessToken);
      setIdentity(id);
    },
    [discovery, redirectUri],
  );

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(IDENTITY_KEY);
    setAccessToken(null);
    setIdentity(null);
  }, []);

  const value = useMemo(
    () => ({ identity, accessToken, loading, signIn, signOut }),
    [identity, accessToken, loading, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

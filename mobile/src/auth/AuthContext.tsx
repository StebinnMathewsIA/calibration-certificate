/**
 * Auth via Supabase Auth (PKCE flow), which federates Microsoft (Azure),
 * Google, and Apple — one integration in-app, provider configuration lives
 * in the Supabase dashboard. Tokens are kept in expo-secure-store, never in
 * AsyncStorage. The backend verifies the same Supabase JWTs server-side
 * (backend/app/auth.py, AUTH_MODE=supabase).
 */
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { TechnicianIdentity } from '@prowalco/schema';
import { config } from '../config';

WebBrowser.maybeCompleteAuthSession();

const SESSION_KEY = 'prowalco.session';

export type Provider = 'microsoft' | 'google' | 'apple';

/** App provider names -> Supabase provider slugs. */
const SUPABASE_PROVIDERS: Record<Provider, string> = {
  microsoft: 'azure',
  google: 'google',
  apple: 'apple',
};

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  /** epoch seconds */
  expiresAt: number;
  identity: TechnicianIdentity;
}

interface AuthState {
  identity: TechnicianIdentity | null;
  accessToken: string | null;
  loading: boolean;
  signIn: (provider: Provider) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const authUrl = (path: string) => `${config.supabase.url}/auth/v1${path}`;

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makePkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64UrlEncode(await Crypto.getRandomBytesAsync(48));
  const digestB64 = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  const challenge = digestB64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { verifier, challenge };
}

interface SupabaseUser {
  id: string;
  email?: string;
  app_metadata?: { provider?: string };
  user_metadata?: { full_name?: string; name?: string };
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: SupabaseUser;
}

async function tokenRequest(query: string, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(authUrl(`/token?grant_type=${query}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: config.supabase.anonKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase token exchange failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as TokenResponse;
}

function toSession(tokens: TokenResponse, provider: Provider): StoredSession {
  const u = tokens.user;
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
    identity: {
      subject: u.id,
      name: u.user_metadata?.full_name ?? u.user_metadata?.name ?? u.email ?? 'Technician',
      authMethod: provider,
    },
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [loading, setLoading] = useState(true);

  const persist = useCallback(async (s: StoredSession | null) => {
    if (s) await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(s));
    else await SecureStore.deleteItemAsync(SESSION_KEY);
    setSession(s);
  }, []);

  // Restore on launch; refresh the access token if it is (nearly) expired.
  useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(SESSION_KEY);
        if (!raw) return;
        let stored: StoredSession = JSON.parse(raw);
        if (stored.expiresAt < Date.now() / 1000 + 60) {
          try {
            const tokens = await tokenRequest('refresh_token', {
              refresh_token: stored.refreshToken,
            });
            stored = toSession(tokens, stored.identity.authMethod);
            await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(stored));
          } catch {
            // Offline at launch: keep the stored session — signing stays
            // queued locally and the queue retries once we're back online
            // and the token refresh succeeds on a later drain.
          }
        }
        setSession(stored);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const signIn = useCallback(
    async (provider: Provider) => {
      if (!config.supabase.url || !config.supabase.anonKey) {
        throw new Error('Supabase is not configured (EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY)');
      }
      const redirect = Linking.createURL('auth-callback');
      const { verifier, challenge } = await makePkcePair();
      const url =
        authUrl('/authorize') +
        `?provider=${SUPABASE_PROVIDERS[provider]}` +
        `&redirect_to=${encodeURIComponent(redirect)}` +
        `&code_challenge=${challenge}&code_challenge_method=s256`;

      const result = await WebBrowser.openAuthSessionAsync(url, redirect);
      if (result.type !== 'success') throw new Error(`Sign-in ${result.type}`);
      const code = new URL(result.url).searchParams.get('code');
      if (!code) throw new Error('No authorization code returned');

      const tokens = await tokenRequest('pkce', { auth_code: code, code_verifier: verifier });
      await persist(toSession(tokens, provider));
    },
    [persist],
  );

  const signOut = useCallback(async () => {
    await persist(null);
  }, [persist]);

  const value = useMemo<AuthState>(
    () => ({
      identity: session?.identity ?? null,
      accessToken: session?.accessToken ?? null,
      loading,
      signIn,
      signOut,
    }),
    [session, loading, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

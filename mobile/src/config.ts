/**
 * Runtime config. Values come from the Expo manifest `extra` (populated in
 * app.config.js), read via expo-constants — this is present in EVERY run
 * mode: Expo Go, the dev client, and standalone builds. A process.env
 * fallback covers any edge case. NO secrets here — the anon key is a
 * publishable client key; the service-role key and the Anthropic API key
 * live only on the backend.
 */
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  apiUrl?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  branchCode?: string;
};

export const config = {
  apiUrl: extra.apiUrl ?? process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000',
  supabase: {
    /** https://<project-ref>.supabase.co — Supabase Auth federates
     * Microsoft (Azure), Google, and Apple for the app. */
    url: extra.supabaseUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    anonKey: extra.supabaseAnonKey ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  },
  /** Branch code used for certificate numbers (PWC-{branch}-...). */
  branchCode: extra.branchCode ?? process.env.EXPO_PUBLIC_BRANCH_CODE ?? 'JHB',
} as const;

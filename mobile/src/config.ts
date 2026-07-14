/**
 * Runtime config. All values come from EXPO_PUBLIC_* env vars set per EAS
 * build profile (eas.json). NO secrets here — the anon key is a publishable
 * client key; the service-role key and the Anthropic API key live only on
 * the backend.
 */
export const config = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000',
  supabase: {
    /** https://<project-ref>.supabase.co — Supabase Auth federates
     * Microsoft (Azure), Google, and Apple for the app. */
    url: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  },
  /** Branch code used for certificate numbers (PWC-{branch}-...). */
  branchCode: process.env.EXPO_PUBLIC_BRANCH_CODE ?? 'JHB',
} as const;

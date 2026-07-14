/**
 * Runtime config. All values come from EXPO_PUBLIC_* env vars set per EAS
 * build profile (eas.json). NO secrets here — the Anthropic API key lives
 * only on the backend; the app talks to the backend, never to Claude.
 */
export const config = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000',
  auth: {
    /** OIDC broker issuer (Auth0 / Cognito / Firebase) that federates
     * Microsoft, Google, and Apple. */
    issuer: process.env.EXPO_PUBLIC_AUTH_ISSUER ?? '',
    clientId: process.env.EXPO_PUBLIC_AUTH_CLIENT_ID ?? '',
    scopes: ['openid', 'profile', 'email', 'offline_access'],
  },
  /** Branch code used for certificate numbers (PWC-{branch}-...). */
  branchCode: process.env.EXPO_PUBLIC_BRANCH_CODE ?? 'JHB',
} as const;

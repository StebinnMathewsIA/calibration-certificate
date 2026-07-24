// Dynamic Expo config. Extends the static app.json and injects the app's
// publishable client config into `extra`, so it is embedded in the Expo
// manifest and readable via expo-constants in EVERY run mode — Expo Go, the
// dev client (served in the Metro manifest), and standalone builds (baked in).
//
// This deliberately does NOT rely on `.env` being loaded by Metro at the
// right moment: the values below are publishable client config (they ship in
// the app bundle by design — no secrets), taken from EXPO_PUBLIC_* env when
// present (EAS builds set them from eas.json) and falling back to literals so
// the app is never left unconfigured. Keep in sync with mobile/.env and
// eas.json.
module.exports = ({ config }) => ({
  ...config,
  // EAS Update (#61): the project id is injected by `eas init` in CI, so the
  // build's update URL and the publish target always agree. Locally without a
  // project id, updates are simply disabled (dev client uses Metro anyway).
  ...(config.extra?.eas?.projectId
    ? { updates: { url: `https://u.expo.dev/${config.extra.eas.projectId}` } }
    : {}),
  runtimeVersion: { policy: 'appVersion' },
  extra: {
    ...(config.extra ?? {}),
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'https://prowalco-calibration-api.onrender.com',
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://pkaadtgmdouuhgrcshft.supabase.co',
    supabaseAnonKey:
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_bwmhQApmp2TqgPPQzhR8mQ_dCApwLgd',
    branchCode: process.env.EXPO_PUBLIC_BRANCH_CODE ?? 'JHB',
  },
});

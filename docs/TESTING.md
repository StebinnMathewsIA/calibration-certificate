# Human / on-device testing checklist

Living checklist of everything that cannot be verified from the development
environment (Constitution, Article 4). Tick items off as they are confirmed on
real devices; anything new that needs human testing gets added here.

## Prerequisites (one-time setup the tests depend on)

- [ ] Azure / Google / Apple providers enabled in Supabase Auth
      (docs/supabase-setup.md §4), redirect URL `prowalco-cal://auth-callback`
      allow-listed
- [ ] Backend deployed on Render (issue #2): create account at render.com →
      New → Blueprint → select this repo → fill in the secret env vars →
      deploy. Verify `https://<service>.onrender.com/healthz` returns
      `{"status":"ok"}` (first hit after idle takes ~30–60 s — free tier wakes
      from sleep)
- [ ] `EXPO_PUBLIC_API_URL` in `mobile/eas.json` updated to the Render URL
- [ ] EAS development build installed on a test device (`eas build --profile
      development`) — requires `eas init` against Prowalco's EAS account
- [ ] Real Prowalco logo dropped into `mobile/assets/logo-base64.ts`

## Auth (Supabase PKCE flow)

- [ ] Sign in with Microsoft (Azure) completes and returns to the app
- [ ] Sign in with Google completes and returns to the app
- [ ] Sign in with Apple completes and returns to the app (required by App
      Store rules on iOS)
- [ ] Session survives app kill/restart; expired token refreshes on launch
- [ ] Sign out clears the session

## Calibration form (on-device UX)

- [ ] Draft autosaves on every field change and survives app kill/restart
- [ ] Error (mL / %) and pass/fail compute live as volumes are typed
- [ ] Expired reference standard blocks signing with a visible reason
- [ ] As-left table appears only when "Adjustment performed" is on

## Signing & offline queue (the milestone-5 acceptance test)

- [ ] Biometric/PIN re-prompt appears on Sign and cancelling aborts cleanly
- [ ] GPS consent toggle off ⇒ no location in the audit payload
- [ ] **Airplane-mode test:** sign offline → package queues → reconnect →
      certificate issues exactly once (check Supabase: one row, one PDF)
- [ ] Kill the app while QUEUED_FOR_SIGNING → relaunch → upload still happens
- [ ] Signed PDF opens and shares from the Issued screen
- [ ] Visible signature widget shows on the last page of the signed PDF
- [ ] Adobe Reader signature panel validates the signature once a trusted
      (non-dev) signing certificate is configured — dev cert will show as
      untrusted, which is expected

## Claude analysis

- [ ] Verdict card renders for pass / marginal / fail / data_anomaly
      (requires ANTHROPIC_API_KEY on the deployed backend)
- [ ] Analysis unavailable (offline) still allows signing, with the advisory
      notice shown

## PDF fidelity

- [ ] Pixel-review rendered certificate against a sample SANAS certificate
      (layout, fonts, tables, footer page numbers)

## Not yet implemented (do not test — future issues)

- Barcode/QR scan for serial numbers (expo-camera wiring)
- Photo capture (seal/totaliser/display) and photo hashes in the audit trail
- Manager push/email notification channel (currently a logging stub)
- KMS-held signing key + RFC 3161 TSA in production signing

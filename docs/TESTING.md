# Human / on-device testing checklist

Living checklist of everything that cannot be verified from the development
environment (Constitution, Article 4). Tick items off as they are confirmed on
real devices; anything new that needs human testing gets added here.

## Prerequisites (one-time setup the tests depend on)

- [ ] Azure / Google / Apple providers enabled in Supabase Auth
      (docs/supabase-setup.md §4), redirect URL `prowalco-cal://auth-callback`
      allow-listed
- [ ] Backend deployed and Live on Render (issue #2) at
      https://prowalco-calibration-api.onrender.com — verify `/healthz`
      returns `{"status":"ok"}` (first hit after idle takes ~30–60 s — free
      tier wakes from sleep)
- [x] `mobile/eas.json` points at the live backend + Supabase project
      (issue #3)
- [ ] EAS development build installed on a test device (issue #3). On a
      computer with Node 20+:
      1. `cd mobile && npm install`
      2. `npx eas-cli login` then `npx eas-cli init` (Expo account)
      3. `npx eas-cli build --profile development --platform android`
         (or `ios` — needs an Apple Developer account)
      4. Install the build from the QR/link, then `npx expo start --dev-client`
- [ ] Real Prowalco logo dropped into `mobile/assets/logo-base64.ts`

## Running via Expo Go (quick UI checks only)

`npx expo start` + scanning the QR runs the app in Expo Go with config from
`mobile/.env`. Good for: sign-in, form UX, drafts, review screen. NOT
supported in Expo Go (needs a dev/preview build): PDF render+hash
(react-native-quick-crypto), biometric re-prompt, actual signing/queue
upload — the sign step will error in Expo Go by design.

## Auth (Supabase PKCE flow)

- [ ] Sign in with Microsoft (Azure) completes and returns to the app
- [ ] Sign in with Google completes and returns to the app
- [ ] Sign in with Apple on iOS uses the NATIVE sheet (Face ID, no browser)
      and lands signed-in on Home — requires the app bundle ID
      `za.co.prowalco.calibration` added to the Supabase Apple provider's
      Client IDs (alongside the Services ID)
- [ ] Sign in with Apple on Android completes via the web flow
- [ ] Session survives app kill/restart; expired token refreshes on launch
- [ ] Sign out clears the session

## Work orders → dispensers (simulated OnKey)

- [ ] Home lists the work orders assigned to the signed-in email; pull to
      refresh caches them (works again offline)
- [ ] Open a work order → site summary + dispenser pick list
- [ ] A dispenser with missing identity (e.g. DISP-002) shows "identity
      incomplete"; completing it on the identity screen persists and the next
      visit prefills from our store (source stays "onkey")
- [ ] **Add a dispenser** OnKey doesn't know about → appears as source "added"
- [ ] **Retire a dispenser** → drops off the active list, shown under Retired
- [ ] Component register (hoses + meter/PC board/pulsar/solenoid + Qmin/Qmax)
      saves and prefills on the next verification of the same dispenser

## Verification results (on-device UX)

- [ ] Draft autosaves as fields change and survives app kill/restart
- [ ] EFD (%) and pass/fail compute live as VFD/VREF are typed
- [ ] A failed checklist item or out-of-tolerance delivery flips the suggested
      outcome to Rejected and requires a Rejection Cert. No. before signing
- [ ] Expired reference measure blocks signing with a visible reason

## UX improvements round (issues #13–#19, 2026-07)

Requires a NEW EAS development build — two native modules were added
(`react-native-webview`, `@react-native-community/datetimepicker`).

### Home & queue visibility (#13)
- [ ] Leave a draft mid-results, kill the app → the draft appears under
      "In progress on this device" on the Work orders tab and resumes at
      the results screen
- [ ] Queued/uploading items open the signing-status screen, not a form
- [ ] Airplane mode with a queued certificate shows the offline banner with
      a count; reconnect or "Sync now" clears it
- [ ] A failed upload shows its reason and "Retry now" retries immediately

### Sign screen (#14, #16, #19)
- [ ] "What you are certifying" digest matches the entered results (worst
      EFD, rejected hose count)
- [ ] Certificate preview renders the NRCS A4-landscape layout and
      pinch-zooms; captured client/VO signatures appear in it
- [ ] Claude review auto-runs on entry (loading card); offline it degrades
      to an inline note and signing stays possible
- [ ] A fail / data_anomaly verdict asks "Sign anyway?" once; pass/marginal
      do not
- [ ] Expiry date opens the native date picker (Android dialog / iOS inline)
      and never shifts a day
- [ ] Reference proving measures show IN DATE / DUE SOON / EXPIRED badges
- [ ] After signing, the status screen steps advance live
      (queued → uploading → signed → synced)

### Results entry (#15)
- [ ] Tolerance-used bar appears once VFD + VREF are entered and colours
      green/amber/red as the EFD approaches ±0.5 %
- [ ] "Still to enter" line and amber checklist markers update live
- [ ] Keyboard "next" chains flow → VFD → VREF → next delivery

### Offline verification start (#18)
- [ ] Open a work order online first, then airplane mode → Verify →
      Save & start succeeds; header shows "number pending"
- [ ] Reconnecting assigns the certificate number automatically (check it
      appears on Home and in the results header)
- [ ] A numberless draft cannot be signed (readiness reason shown)

### Issued screen + scan (#17, #19)
- [ ] Issued screen leads with Share; crypto details behind the disclosure
- [ ] Scanning a QR and a Code 128 label fills the serial number on the
      dispenser identity screen and the add-dispenser form
- [ ] Muted text legible outdoors at full brightness

### Signatures & profile name (#21, #22)
- [ ] Drawing a signature (client or profile) logs no console error and no
      strokes are lost, including fast multi-stroke signatures
- [ ] My profile: first name(s) + surname save, and the "On certificate"
      preview shows the Initial & Surname form (e.g. "S. Mathews")
- [ ] Re-draw the VO signature once after updating (an empty one may be
      cached from before the #21 fix)
- [ ] A newly issued PDF shows BOTH the client signature and the VO
      signature in the sign-off blocks, and the VO as "F. Surname"
- [ ] Header avatar shows the first letters of first name + surname

### Brand kit (#23)
- [ ] Fonts load: headings in Barlow Semi Condensed, body in Inter, numeric
      inputs/readouts (VFD/VREF, EFD, serials, SHA) in Roboto Mono with
      aligned digits
- [ ] App bars are navy with white titles; tab bar is white with a hairline,
      active tab in dark green
- [ ] Primary buttons are lime green with NAVY text (no white-on-green
      anywhere); secondary buttons are navy outlines; danger solid red
- [ ] Status chips are tinted pills (pass/due/fail) with a word or ✓/⚠/✗ —
      never colour alone; no ALL-CAPS labels anywhere
- [ ] Sync banner uses the blue info tint online / amber tint offline
- [ ] Certificate PDF is visually UNCHANGED (still matches the NRCS document
      — the brand kit is app-UI only)

## Signing & offline queue (the milestone-5 acceptance test)

- [ ] Client draws a signature on the pad; "Sign" is blocked until they do
- [ ] Biometric/PIN re-prompt appears on Sign and cancelling aborts cleanly
- [ ] GPS consent toggle off ⇒ no location in the audit payload
- [ ] **Airplane-mode test:** sign offline → package queues → reconnect →
      certificate issues exactly once (check Supabase: one row, one PDF)
- [ ] Kill the app while QUEUED_FOR_SIGNING → relaunch → upload still happens
- [ ] Signed PDF opens and shares from the Issued screen; the client's drawn
      signature is embedded in the PDF
- [ ] Visible VO signature widget shows on the last page of the signed PDF
- [ ] Adobe Reader signature panel validates the signature once a trusted
      (non-dev) signing certificate is configured — dev cert will show as
      untrusted, which is expected

## Claude analysis

- [ ] Verdict card renders for pass / marginal / fail / data_anomaly
      (requires ANTHROPIC_API_KEY on the deployed backend)
- [ ] Analysis unavailable (offline) still allows signing, with the advisory
      notice shown

## PDF fidelity

- [ ] Pixel-review rendered certificate against the NRCS Verification
      Certificate + Metrologist Note (header/logo, reference measures,
      component tables, checklist, EFD deliveries, sign-off, footer)

## Not yet implemented (do not test — future issues)

- Barcode/QR scan for serial numbers (expo-camera wiring)
- Photo capture (seal/totaliser/display) and photo hashes in the audit trail
- Manager push/email notification channel (currently a logging stub)
- KMS-held signing key + RFC 3161 TSA in production signing

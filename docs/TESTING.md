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

### Header & bottom nav (#25)
- [ ] Tab screens show the "prowalco" wordmark (green, blue "o") left-aligned
      on a flat navy bar with the avatar on the right
- [ ] Tab icons are the custom clipboard / fuel-pump vectors — correctly
      tinted dark-green active / steel inactive, slightly bolder when active;
      no emoji anywhere
- [ ] Tab bar: white, hairline top border, no shadow; labels legible at 11px
- [ ] Stack screens (work order, results, sign…) keep flat navy bars with a
      minimal back arrow (no iOS back-label text)

### Certificate page size & VO name (#27, #28)

- [ ] A certificate issued from an **iOS** device is A4 landscape — open the
      PDF and check the page measures 842×595 pt / 297×210 mm (was US Letter
      portrait before #27); Android output unchanged
- [ ] With an empty profile and an IdP account that has no display name, the
      certificate VO field shows a name (e.g. "Stebinn" or "S. Mathews"
      depending on what the mailbox yields) — NEVER the email address
- [ ] Sign in with an account whose IdP profile HAS a name → VO falls back to
      "Initial & Surname" form when the app profile is empty
- [ ] A session from before #28 (VO name showed the email): relaunch the app
      online once → the identity rebuilds and new certificates no longer show
      the email

### Apple / IdP name capture (#29)

- [ ] FIRST Apple authorization (revoke first: Settings → Apple ID → Sign-In
      &amp; Security → Sign in with Apple → this app → Stop using Apple ID):
      sign in with Apple → My profile shows First name(s) + Surname prefilled,
      and they SURVIVE sign-out/sign-in (persisted to Supabase user metadata —
      check the user's `user_metadata` in the Supabase dashboard)
- [ ] Microsoft/Google sign-in with given/family name claims seeds an empty
      profile the same way
- [ ] A profile the VO already typed a name into is NEVER overwritten by
      sign-in seeding

### Drafts grouped under work orders; archive on close (#30, #31)

- [ ] A draft started from a work order appears indented under that work
      order's card on Home (not in a separate flat list)
- [ ] An in-progress item whose work order is no longer shown (or that has no
      work order) still appears under "In progress on this device"
- [ ] Mark a work order `completed` in the backend fixtures → Refresh work
      orders → its drafts leave the list and the muted "N archived draft(s)
      from closed work orders" line appears; the work order card is gone too
- [ ] A QUEUED/SIGNED verification for that closed work order is NOT
      archived and continues to sync
- [ ] Airplane mode + Refresh archives nothing
- [ ] Existing installs upgrade cleanly (archived_at column added without
      losing drafts)

### Home greeting header (#32)

- [ ] Home shows "Hello, {first name}" (profile first name; sensible word
      from the sign-in name when the profile is empty) with the open
      work-order count beneath — no wordmark/logo on this screen
- [ ] Count matches the "My open work orders" list and still shows from
      cache in airplane mode
- [ ] Greeting doesn't collide with the status bar (safe area respected,
      both platforms)
- [ ] Avatar top-right opens My profile; Sites tab keeps the navy wordmark
      bar

### Floating pill bottom nav (#33)

- [ ] Bottom nav is a centred floating pill (card surface, hairline border);
      no full-width bar; both navs stay on brand (navy active square, custom
      clipboard/fuel-pump icons, no foreign colours or emoji)
- [ ] Active tab = navy rounded square with white icon; switching tabs moves
      it and the inactive icon is muted
- [ ] Last card on each tab scrolls fully clear of the pill
- [ ] Pill clears the iOS home indicator / Android gesture bar
- [ ] VoiceOver/TalkBack read "Work orders" / "Sites" with selected state
- [ ] (#34) Tapping Sites in the pill actually opens the Sites tab, and
      Work orders returns — verify on BOTH platforms (touch fall-through to
      the screen layer was the #34 bug)

### Certificate output round 2 (#35, #36, #37)

- [ ] iOS-issued PDF page 1: rotated group labels (LFD Description / Meter /
      PC Board / Pulsar / Solenoid Valve) sit inside their own column — no
      overlap with Make/Model/Serial labels (verified in Chromium; iOS
      renderer is the one that previously overflowed)
- [ ] Metrologist note: Verification Status prints "New" / "Repaired" /
      "ATU" / "Rej" (not lowercase raw values)
- [ ] Newly issued PDF opens in Adobe Reader as a CERTIFIED document
      (blue-ribbon panel); editing the file afterwards invalidates the
      certification (DocMDP no-changes) — note: backend must be redeployed
      for #37 to take effect
- [ ] App still accepts/verifies the returned signed PDF end-to-end after
      the certify change

### Internal tester demo package (#38)

- [ ] sashern@prowalco.co.za signs in (any provider) and sees WO-4714 ·
      Sasol Kyalami Corner with 2 dispensers
- [ ] DISP-301 prefills complete; DISP-302 asks for identity completion
- [ ] Owner action (cannot be done from the repo): add the tester to the
      EAS/TestFlight internal distribution so they can install the build

### Home refresh icon, draft recency & deletion (#39, #40, #41)

- [ ] Idle Home shows NO full-width "Refresh work orders" button; a circular
      refresh icon sits in the greeting header left of the avatar
- [ ] Tapping the icon refreshes work orders; while in flight the icon shows
      a spinner (the in-content "Refreshing…" bar was removed by #44)
- [ ] VoiceOver/TalkBack read the icon as "Refresh work orders"
- [ ] Draft / Ready-to-sign cards show "Last saved …" ("just now" → "N min
      ago" → "N h ago" → date + time); editing a draft and returning to Home
      updates it
- [ ] With several drafts under one work order, the most recently edited
      draft is listed first; editing an older one moves it to the top
- [ ] Trash icon appears ONLY on Draft / Ready-to-sign cards (not queued /
      uploading / signed); tapping it asks for confirmation naming the site
      and certificate number
- [ ] Cancel keeps the draft; Delete removes it permanently (still gone
      after app kill/restart)

### Shared tab header + guaranteed back button (#42, #43)

- [ ] Sites tab shows the same header as Home: large "Sites" title, site
      count subtitle, refresh icon left of the avatar — no navy wordmark bar
- [ ] Sites refresh via the icon works (spinner in the icon only, no bar —
      #44); avatar still opens My profile
- [ ] **#43 regression:** Home → tap a work-order card → a back chevron IS
      visible in the navy header and returns to Home (verify on BOTH
      platforms; this was the stranded-screen bug)
- [ ] Back chevron present and working on every pushed screen: site,
      dispenser identity, components, results, review & sign, signing
      status, certificate, profile
- [ ] Sign-in screen shows no back chevron — including immediately after
      signing out from the profile screen
- [ ] Signature capture screen still has NO back button and no swipe-back
      (Save / Cancel only)
- [ ] iOS swipe-back gesture still works alongside the custom chevron

### Single refresh indicator + tappable bottom nav (#44, #45)

- [ ] Refresh on Home and Sites shows ONLY the spinner inside the header
      icon — no "Refreshing…" bar ever appears, and the list does not jump
- [ ] **#45 regression (was the broken one):** tapping the fuel-pump icon
      in the pill OPENS the Sites tab; tapping the clipboard returns to
      Work orders — verify on BOTH platforms
- [ ] Pill still looks floating (centred, rounded, shadow, navy active
      square) and clears the iOS home indicator / Android gesture bar
- [ ] Last card on each tab scrolls fully into view above the pill (scroll
      padding was reduced — check nothing hides behind the bar)

### TestFlight auto-submit build (#46)

- [ ] One-time on a computer: `cd mobile && npx eas-cli build -p ios
      --profile production --auto-submit` — the interactive prompts store
      the Apple distribution cert + App Store Connect API key with EAS
- [ ] After that, the eas-build workflow with platform=ios,
      profile=production, submit=true queues a build that lands in
      TestFlight with no manual steps
- [ ] Internal Testing group in App Store Connect includes the tester and
      they receive the build notification

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

## Production signing — AWS KMS (#24)

Needs a real AWS account (the code path itself is covered by
`backend/tests/test_kms_signer.py` against a fake KMS).

- [ ] Provision per docs/key-rotation-runbook.md § Provisioning; backend
      starts with `SIGNING_KEY_PROVIDER=aws_kms` and refuses to start when
      the key ID or certificate is missing
- [ ] Sign a staging verification end-to-end; signature validates against
      `ca-cert.pem` (Adobe: trusted after adding the internal CA)
- [ ] CloudTrail shows one `kms:Sign` event per issued certificate
- [ ] Confirm no `SIGNING_KEY_PEM_B64` remains in the host env

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

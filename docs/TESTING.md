# Human / on-device testing checklist

Living checklist of everything that cannot be verified from the development
environment (Constitution, Article 4). Tick items off as they are confirmed on
real devices; anything new that needs human testing gets added here.

## Prerequisites (one-time setup the tests depend on)

- [ ] Azure / Google / Apple providers enabled in Supabase Auth
      (docs/supabase-setup.md §4), redirect URL `prowalco-cal://auth-callback`
      allow-listed
- [ ] Backend deployed and reachable at the URL in `mobile/eas.json`
      (`EXPO_PUBLIC_API_URL`) — note: no backend host has been provisioned yet
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

### UX improvements round (2026-07)

Requires a NEW EAS development build — two native modules were added
(`@react-native-community/datetimepicker`, `react-native-webview`).

- [ ] Leaving a required field empty/invalid shows an inline error on blur;
      an untouched empty draft shows no red anywhere
- [ ] Section chips at the top show ✓ / open-item counts live and tapping a
      chip scrolls to that section (Android + iOS scroll offsets look right)
- [ ] Calibration date opens the native date picker (Android dialog, iOS
      inline) and never shifts a day across timezones
- [ ] Test-point PASS/FAIL badge and tolerance-used bar update live; keyboard
      "next" chains nominal → flow → indicated → measured → next point
- [ ] "Set up standard 3-point run" and "Duplicate last set-up" scaffold rows
      (duplicate copies nominal + flow only, never readings)
- [ ] Barcode/QR scan button fills the UUT serial number (test a QR and a
      Code 128 label); camera permission prompt appears once
- [ ] Photo capture (seal/totaliser/display/other) stores thumbnails,
      Remove deletes them, and photo SHA-256 refs appear in the form payload
- [ ] "Same site as your last job?" prefill fills customer/site/UUT fields
      and disappears once a customer name is present
- [ ] Reference-standard rows show EXPIRED / DUE SOON badges before selection
- [ ] Sunlight readability: muted text and chips legible outdoors at full
      brightness

## Review & sign screen

- [ ] Summary digest matches the entered data (worst error, fail count)
- [ ] Certificate preview renders in the WebView, pinch-zoom works, and the
      layout matches the generated PDF
- [ ] Claude review auto-runs when the form is ready (skeleton while loading);
      offline it degrades to an inline hint and a manual Run button
- [ ] "Review in form →" links under concerns jump to the right form section
- [ ] A fail / data_anomaly verdict asks "Sign anyway?" once before signing;
      pass/marginal verdicts do not
- [ ] After signing, the status screen steps advance live
      (queued → uploading → signed → synced) and "View issued certificate"
      appears at the end

## Home dashboard & sync

- [ ] Filter chips (All / In progress / Waiting to sign / Issued) show correct
      counts; search matches customer, serial and certificate number
- [ ] Offline banner appears in airplane mode; "Sync now" drains the queue on
      reconnect; per-item "Retry now" appears after a failed attempt
- [ ] Airplane mode → "New calibration" still works; the draft shows
      "Number pending — assigns when online" and the number backfills
      automatically on reconnect (check it also lands in the form payload)
- [ ] Sign out now requires the header button + confirmation (no footer
      mis-tap)
- [ ] Tapping a queued/uploading item opens the signing-status screen, not the
      editable form

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

- Manager push/email notification channel (currently a logging stub)
- KMS-held signing key + RFC 3161 TSA in production signing
- Photos embedded in the certificate PDF appendix (photos are currently
  hashed into the form payload / audit trail only)

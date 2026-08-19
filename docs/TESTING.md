# Human / on-device testing checklist

Living checklist of everything that cannot be verified from the development
environment (Constitution, Article 4). Tick items off as they are confirmed on
real devices; anything new that needs human testing gets added here.

## Prerequisites (one-time setup the tests depend on)

- [ ] Azure / Google / Apple providers enabled in Supabase Auth
      (docs/supabase-setup.md §4), redirect URL `prowalco-cal://auth-callback`
      allow-listed
- [ ] Backend deployed and Live on Render (issue #2) at
      https://prowalco-calibration-api.onrender.com, verify `/healthz`
      returns `{"status":"ok"}` (first hit after idle takes ~30–60 s, free
      tier wakes from sleep)
- [x] `mobile/eas.json` points at the live backend + Supabase project
      (issue #3)
- [ ] EAS development build installed on a test device (issue #3). On a
      computer with Node 20+:
      1. `cd mobile && npm install`
      2. `npx eas-cli login` then `npx eas-cli init` (Expo account)
      3. `npx eas-cli build --profile development --platform android`
         (or `ios`, needs an Apple Developer account)
      4. Install the build from the QR/link, then `npx expo start --dev-client`
- [ ] Real Prowalco logo dropped into `mobile/assets/logo-base64.ts`

## Running via Expo Go (quick UI checks only)

`npx expo start` + scanning the QR runs the app in Expo Go with config from
`mobile/.env`. Good for: sign-in, form UX, drafts, review screen. NOT
supported in Expo Go (needs a dev/preview build): PDF render+hash
(react-native-quick-crypto), biometric re-prompt, actual signing/queue
upload, the sign step will error in Expo Go by design.

## Auth (Supabase PKCE flow)

- [ ] Sign in with Microsoft (Azure) completes and returns to the app
- [ ] Sign in with Google completes and returns to the app
- [ ] Sign in with Apple on iOS uses the NATIVE sheet (Face ID, no browser)
      and lands signed-in on Home, requires the app bundle ID
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

Requires a NEW EAS development build, two native modules were added
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
- [ ] Status chips are tinted pills (pass/due/fail) with a word or ✓/⚠/✗:
      never colour alone; no ALL-CAPS labels anywhere
- [ ] Sync banner uses the blue info tint online / amber tint offline
- [ ] Certificate PDF is visually UNCHANGED (still matches the NRCS
      document; the brand kit is app-UI only)

### Header & bottom nav (#25)
- [ ] Tab screens show the "prowalco" wordmark (green, blue "o") left-aligned
      on a flat navy bar with the avatar on the right
- [ ] Tab icons are the custom clipboard / fuel-pump vectors, correctly
      tinted dark-green active / steel inactive, slightly bolder when active;
      no emoji anywhere
- [ ] Tab bar: white, hairline top border, no shadow; labels legible at 11px
- [ ] Stack screens (work order, results, sign…) keep flat navy bars with a
      minimal back arrow (no iOS back-label text)

### Certificate page size & VO name (#27, #28)

- [ ] A certificate issued from an **iOS** device is A4 landscape, open the
      PDF and check the page measures 842×595 pt / 297×210 mm (was US Letter
      portrait before #27); Android output unchanged
- [ ] With an empty profile and an IdP account that has no display name, the
      certificate VO field shows a name (e.g. "Stebinn" or "S. Mathews"
      depending on what the mailbox yields), NEVER the email address
- [ ] Sign in with an account whose IdP profile HAS a name → VO falls back to
      "Initial & Surname" form when the app profile is empty
- [ ] A session from before #28 (VO name showed the email): relaunch the app
      online once → the identity rebuilds and new certificates no longer show
      the email

### Apple / IdP name capture (#29)

- [ ] FIRST Apple authorization (revoke first: Settings → Apple ID → Sign-In
      &amp; Security → Sign in with Apple → this app → Stop using Apple ID):
      sign in with Apple → My profile shows First name(s) + Surname prefilled,
      and they SURVIVE sign-out/sign-in (persisted to Supabase user metadata:
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
      work-order count beneath, no wordmark/logo on this screen
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
      Work orders returns, verify on BOTH platforms (touch fall-through to
      the screen layer was the #34 bug)

### Certificate output round 2 (#35, #36, #37)

- [ ] iOS-issued PDF page 1: rotated group labels (LFD Description / Meter /
      PC Board / Pulsar / Solenoid Valve) sit inside their own column, no
      overlap with Make/Model/Serial labels (verified in Chromium; iOS
      renderer is the one that previously overflowed)
- [ ] Metrologist note: Verification Status prints "New" / "Repaired" /
      "ATU" / "Rej" (not lowercase raw values)
- [ ] Newly issued PDF opens in Adobe Reader as a CERTIFIED document
      (blue-ribbon panel); editing the file afterwards invalidates the
      certification (DocMDP no-changes), note: backend must be redeployed
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
      count subtitle, refresh icon left of the avatar, no navy wordmark bar
- [ ] Sites refresh via the icon works (spinner in the icon only, no bar:
      #44); avatar still opens My profile
- [ ] **#43 regression:** Home → tap a work-order card → a back chevron IS
      visible in the navy header and returns to Home (verify on BOTH
      platforms; this was the stranded-screen bug)
- [ ] Back chevron present and working on every pushed screen: site,
      dispenser identity, components, results, review & sign, signing
      status, certificate, profile
- [ ] Sign-in screen shows no back chevron, including immediately after
      signing out from the profile screen
- [ ] Signature capture screen still has NO back button and no swipe-back
      (Save / Cancel only)
- [ ] iOS swipe-back gesture still works alongside the custom chevron

### Single refresh indicator + tappable bottom nav (#44, #45)

- [ ] Refresh on Home and Sites shows ONLY the spinner inside the header
      icon, no "Refreshing…" bar ever appears, and the list does not jump
- [ ] **#45 regression (was the broken one):** tapping the fuel-pump icon
      in the pill OPENS the Sites tab; tapping the clipboard returns to
      Work orders, verify on BOTH platforms
- [ ] Pill still looks floating (centred, rounded, shadow, navy active
      square) and clears the iOS home indicator / Android gesture bar
- [ ] Last card on each tab scrolls fully into view above the pill (scroll
      padding was reduced, check nothing hides behind the bar)

### TestFlight auto-submit build (#46)

- [ ] One-time on a computer: `cd mobile && npx eas-cli build -p ios
      --profile production --auto-submit`, the interactive prompts store
      the Apple distribution cert + App Store Connect API key with EAS
- [ ] After that, the eas-build workflow with platform=ios,
      profile=production, submit=true queues a build that lands in
      TestFlight with no manual steps
- [ ] Internal Testing group in App Store Connect includes the tester and
      they receive the build notification

### IdP-enforced MFA (#50)

- [ ] Owner: complete the console setup in docs/mfa-setup.md (Entra security
      defaults OR Conditional Access; Google 2SV if used; passkeys optional)
- [ ] Fresh tablet, first sign-in → MFA challenge appears in the sign-in
      browser; sign-in completes back into the app
- [ ] Subsequent app launches on the same tablet → NO MFA challenge (session
      refreshes silently)
- [ ] On a tablet without biometrics, Sign still asks for the device
      PIN/pattern (fallback path)
- [ ] Tablet issue checklist/MDM: screen lock required on every field device

### Device binding: trust-on-first-use (#51, #52)

Rollout order matters: verify on-device FIRST, then set
`DEVICE_BINDING_ENFORCE=true` (+ `ADMIN_EMAILS`) on Render.

- [ ] Fresh install, sign a certificate → upload succeeds; Supabase `devices`
      table shows one `active` row for this device + account, and the audit
      event's `deviceBinding.result` is `verified`
- [ ] Sign in with a DIFFERENT account on the same device → its enrollment
      row is `pending`
- [ ] With `DEVICE_BINDING_ENFORCE=true`: the pending account's upload is
      refused with "Ask your administrator to approve this device"; after
      `POST /v1/devices/approve` (admin email) it succeeds
- [ ] Revoked device (`POST /v1/devices/revoke`) cannot sign when enforced
- [ ] Reinstall the app (same account) → re-enrolls with a new key, still
      `active`, signing keeps working
- [ ] Offline sign → queue → reconnect flow unchanged (device signature is
      computed at upload time)

### OnKey WOE001 sync (#47)

- [ ] Owner: generate a long random token; set it as `ONKEY_SYNC_TOKEN` on
      Render (Environment) AND as repo Actions secret `ONKEY_SYNC_TOKEN`
- [ ] Owner: default branch must be `main`, scheduled workflows only run
      from the default branch
- [ ] One-time backfill: Actions → onkey-sync → Run workflow → mode
      `backfill` → job summary shows rows fetched/inserted and the WOE001
      column list (paste the columns into #47 for the provider mapping)
- [ ] The 5-min schedule runs on its own; repeat runs show rowsInserted ≈ 0
      when nothing changed (delta-only writes)
- [ ] Supabase: `onkey_woe001` row count matches the export volume;
      `select data from onkey_woe001 limit 1` shows a full WOE001 row

### Profile from the technician register (#62, #63)

- [ ] Name shows READ-ONLY from the register (no editable name inputs);
      "OnKey record: <staff code> · Manager: …" line shows
- [ ] Demo alias → the ridden technician's name displays; "Demo account:
      register is read-only" note; saving pliers stays local only
- [ ] A real technician (direct OnKey email) saving pliers persists to the
      register (check onkey_technicians row) and re-appears on a fresh
      install
- [ ] Certificate still prints Initial & Surname from the register-sourced
      name; offline profile loads from the local store unchanged

### Certified measures register (#70: supersedes the #48 prefill flow)

- [ ] Fresh sign-in: profile shows NO measures ("No certified measures
      registered yet"), there are no defaults anywhere
- [ ] Home shows a RED "verifications blocked" banner while measures are
      missing/expired; tapping it opens the profile
- [ ] Starting a verification with missing/expired measures is blocked with
      a per-measure reason list (works offline too)
- [ ] Register a measure per size (serial, cert no., cal date, expiry all
      required): it appears active with an in-date badge; the Home banner
      clears once all three are registered and in date
- [ ] Register a replacement for a size: the old one moves to "Measure
      history" (superseded, kept forever); the new one is active
- [ ] Home shows an AMBER "expiring soon" banner when a measure's expiry is
      within 30 days
- [ ] Photos per size still capture/retake and stay on-device
- [ ] Demo alias: measures visible (ridden technician's), register is
      read-only
- [ ] A new verification snapshots the ACTIVE measures into the certificate;
      an issued certificate keeps printing the measures that were active at
      its verification date even after a replacement is registered

### Direct Supabase reads (Arch v2 phase 1, #65)

- [ ] Home, work-order, site, and dispenser screens load noticeably faster
      (first open of a work order well under 1 s on signal, was ~3 s)
- [ ] All read screens show the same data as before the switch (shapes are
      identical; only the transport changed)
- [ ] A technician cannot open another technician's work order (deep-link a
      foreign WO id → "not assigned" error)
- [ ] With the anon key alone (no sign-in), the Supabase REST API returns
      permission errors for both tables and app_* functions
- [ ] Writes (save site, dispensers, component register, profile) still
      work; they still go via the backend

### Offline mirror + outbox (Arch v2 phase 2, #66)

- [ ] Sign in on signal, wait a few seconds (first sync), then enable
      airplane mode: Home, work orders, sites, dispensers, component
      registers, and the profile all open instantly with full data
- [ ] Screens that were synced open with NO spinner even on signal (cached
      copy renders, refresh happens in background)
- [ ] Airplane mode: complete a site identity, edit a dispenser, add a
      dispenser, save a component register, save the profile, all succeed
      locally
- [ ] Return to signal (or foreground the app on wifi): the queued writes
      replay, verify the records on the server (sites/dispensers tables)
- [ ] A new work order assigned in OnKey appears on Home within ~15 min of
      the app being open on signal (5-min WOE001 sync + sync interval)

### Signing v2 (Arch v2 phase 3, #67)

- [ ] The sign screen has NO client-signature capture; the client block asks
      for name + email; the printed certificate shows "Electronic copy
      issued to the client" in the client signature cell
- [ ] Signing end-to-end works on a tablet with no biometrics (device key +
      session are the two factors; the local biometric/PIN prompt appears
      only where hardware exists)
- [ ] First sign from a fresh install enrolls the device transparently
      (TOFU) and succeeds; an admin-revoked device gets a clear rejection
- [ ] After signing with a client email captured, a `certificate_emails`
      row exists with status `held` and the sealed PDF's storage ref
- [ ] No email is actually sent (EMAIL_ENABLED=false until the
      @prowalco.co.za domain is set up post-PoC)

### Certificate archive + history (Arch v2 phase 4, #68)

- [ ] Issue a certificate, open the site: "Verification history" lists it
      (cert number, dispenser, date, VO, expiry), including certificates
      signed by OTHER technicians/devices at that site
- [ ] "Download & share sealed PDF" on a history row fetches the archived
      PDF and opens the share sheet; the shared file opens with a valid
      signature in Adobe Reader
- [ ] History still displays offline after it was viewed once (cache);
      downloading a PDF offline shows a clear needs-connection message
- [ ] Older certificates (issued before this phase) appear with their
      site/dispenser after the backfill migration

### Insights tab (Arch v2 phase 5, #56)

- [ ] Third tab "Insights" (bar-chart icon) in the pill nav; opens with the
      in-content header like Home and Sites
- [ ] "My workload" matches Home: open total, per-status breakdown, open
      sites; "Completed, last 30 days" is plausible for the technician
- [ ] "Completions per month" bar chart shows the last months' completions
- [ ] "My certificates" counts only certificates signed by THIS account
- [ ] "Across Prowalco" shows company aggregates with no names/emails
- [ ] Works offline after first sync (mirror-cached); refresh icon updates
- [ ] Demo alias sees the ridden technician's workload numbers but their
      OWN certificate counts

### Roles + view-as (Phase 6 in-app, #71)

- [ ] Sign in as an admin (owner sign-ins are seeded): Profile shows a
      "View as (admin)" section; Home is EMPTY until a technician is chosen
      (no more busiest-technician riding)
- [ ] Choose a technician from the searchable picker → after the sync,
      Home/sites/insights/history all show THAT technician's real world
- [ ] "Stop viewing as" returns to the empty own scope
- [ ] While viewing-as: profile register edits and measure registration are
      refused (read-only riding); signing would sign as YOURSELF, never as
      the viewed technician
- [ ] A technician sign-in sees no view-as section and no compliance data
- [ ] Insights (role holders only): "Measures compliance" lists every
      technician with missing/expired/expiring measures by name; counts of
      total vs fully-certified match
- [ ] sashern@prowalco.co.za no longer resolves to any workload (alias
      mechanism removed) until given a role or matched by register email

### Admin UI + certificate archive search (#72)

- [ ] Admin: Profile → "Roles & team allocations", grant a manager role by
      email; it appears in the list; revoke works; revoking the LAST admin
      is refused with a clear message
- [ ] Allocate technicians to a manager (search + tap toggles ✓); that
      manager's view-as picker is then limited to their allocation
- [ ] Manager: sees "Certificate archive search" but NOT the admin screen;
      technician sees neither
- [ ] Archive search: empty query lists newest certificates; searching by
      cert number fragment, site, customer, dispenser or VO name filters;
      each row downloads + shares the sealed PDF

### Mini map + Google Maps handoff (#73)

- [ ] Work order screen: sites with GPS show a small map with a marker at
      the site; "Open in Google Maps" opens the Maps APP at that exact point
- [ ] Site screen shows the same map + button
- [ ] A site with an address but no GPS shows only the button (address
      search); a site with neither shows no map block
- [ ] Offline: the map preview may be blank, but the button still opens
      Google Maps (which handles its own offline behavior)

### Production work orders from OnKey (#55, #57)

- [ ] Sign in as stebinn@gmail.com or sashern@prowalco.co.za (demo aliases) →
      Home shows the busiest technician's REAL open work orders, grouped
      into sections: To be Planned / Allocated / Incomplete for Spares /
      Work Order Received / Referral / Work Resumed (empty sections hidden)
- [ ] Greeting subtitle count matches the number of listed work orders
- [ ] A work-order card shows oil company · site name, dispenser count and
      due date; opening it shows the site and its equipment
- [ ] Equipment with no make/model/serial shows "identity incomplete" and
      the on-site completion flow persists it
- [ ] A real technician signing in with their own OnKey email sees THEIR
      open work orders (pick a friendly guinea pig)
- [ ] Closed/costed/cancelled work orders never render on Home
- [ ] Offline: previously loaded work orders still show from cache

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
      (non-dev) signing certificate is configured, dev cert will show as
      untrusted, which is expected

## Production signing: AWS KMS (#24)

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

## Job card capture and sign-off (#109)

None of this has been on a device yet.

- [ ] Job card opens from a started, paused and stopped work order, and
      from a signed-off one as read-only
- [ ] Labour prefills from the measured working time with pauses removed,
      and typing over it is not overwritten by a background refresh
- [ ] Distance, labour and quantity fields accept a decimal comma as well
      as a point on the device keyboard
- [ ] Parts search returns results fast enough to be usable at forecourt
      latency; adding the same part twice bumps the quantity (#112)
- [ ] A part looked up while online is still findable later with no signal
- [ ] Client signature pad: a downward stroke cannot dismiss the window
- [ ] Sign-off is refused until the work is stopped, the work performed is
      described and the client is named
- [ ] After signing, the work order screen behind shows signed off without
      needing to leave and come back
- [ ] Signed job card is read-only and the document shares as a PDF
- [ ] Site rules print as six numbered rules, with "Owner/manager" and
      "HSE rules" (#108)

## Job card offline behaviour (#109)

- [ ] Airplane mode: fill in a job card, sign it, leave, reconnect. The
      save and the sign replay in order and the work order signs off
      exactly once
- [ ] Airplane mode: a queued sign never overtakes the lifecycle event in
      front of it for the same work order
- [ ] Kill the app with an unsaved job card open, relaunch, and the
      autosaved content is there

## Work order lifecycle against OnKey (#96)

- [ ] Two-hop pause for spares live: WOR to WPA to LSI, both hops
      reaching OnKey in order
- [ ] Start and stop a [TEST] work order and confirm the status in OnKey
      matches within a couple of minutes

## Alerting (#113)

- [ ] Insights tab shows the "Needs attention" card to a manager or admin
      and nothing to a technician
- [ ] Owner decides the outbound channel (email, push, or in-app only)

## Not yet implemented (do not test: future issues)

- Barcode/QR scan for serial numbers (expo-camera wiring)
- Photo capture (seal/totaliser/display) and photo hashes in the audit trail
- Manager push/email notification channel (currently a logging stub)
- KMS-held signing key + RFC 3161 TSA in production signing

## Profile signature gate (#128)

- [ ] A technician with no saved signature sees an exclamation marker on
      the profile avatar, on every screen that shows it
- [ ] Job card sign-off is refused with "add your signature to your
      profile" in the still-to-do line, and the shortcut opens the profile
- [ ] Saving a signature clears the marker and allows sign-off
- [ ] The Artisan block on the generated job card is filled

## Job card visits (#121)

- [ ] Travel and labour are entered per visit; adding a second visit works
- [ ] Totals under the visit list equal the sum of the rows
- [ ] The printed job card shows one row per visit and NO working-time
      column
- [ ] The costing block equals the visit totals

## Lifecycle icon row (#122) and stand down (#127)

- [ ] The four verbs are one icon row above the fold at every stage
- [ ] Invalid actions are visibly disabled, not missing
- [ ] "Cannot get there" while on the way asks for confirmation, not a
      pause reason, and returns the job to not started
- [ ] Nothing is queued to OnKey for a stand down

## Work order dispensers (#123) and the verification path (#125)

- [ ] Dispensers on site show make, model and hose count
- [ ] The allocated dispenser is marked "This job" and listed first
- [ ] Tapping a dispenser with no certificate opens it (identity if
      incomplete, otherwise the component register)

## Completed today (#126)

- [ ] Signing off a work order moves it to "Completed today"
- [ ] The header count and the day list agree
- [ ] The section is empty the next morning

## Manager job card, no van (#131)

- [ ] Signed in as a technician with no van, the parts picker still shows
      the full register
- [ ] The Parts used card says nothing on this job card is booked to OnKey
- [ ] Sign-off succeeds and the job card prints travel, labour and parts
- [ ] Nothing appears in the OnKey outbox for that work order

## Syspro stock, scoped to the van (#136, #137)

- [ ] Signed in as a technician with a verified van, the parts picker
      shows only that van's stock, in-stock items first with the quantity
      against each
- [ ] An item the van carries at zero is still listed and still bookable,
      below the in-stock ones
- [ ] Searching something the van does not carry says how many parts were
      searched, rather than showing an empty list with no explanation
- [ ] Signed in as a technician with no van, the picker still shows the
      whole register and sign-off still books nothing (#131)
- [ ] Signed in as a technician whose van is not set, the picker shows the
      whole register and says the van is not set
- [ ] Signed in as a manager whose OnKey name IS mapped, the picker spans
      their technicians' vans

### Manager name mapping: needs Prowalco to confirm

Four of the six people named as a manager in OnKey have no technician
record of their own, so their sign-in email cannot be matched to the name
OnKey knows them by. Between them they lead 50 technicians. Until each is
mapped, those managers sign in and are told their team cannot be resolved,
with the reason given.

`SELECT * FROM manager_names_unmapped;` is the live work list. Map each
with `SELECT manager_name_set('<email>', '<name as OnKey spells it>');`.

- [ ] Prowalco confirms the sign-in email for each of the four unmapped
      manager names
- [ ] Each is mapped, and `manager_names_unmapped` returns no rows
- [ ] Each of those managers signs in and sees their own team's vans, and
      not another manager's

## Stock tab (#138) and allocation (#139)

- [ ] A technician with a verified van sees a Stock tab showing their own
      van, with the van named in the header
- [ ] Items are in-stock first, with the quantity and unit against each
- [ ] Searching a code or a description filters the van
- [ ] The header says when the stock was last loaded from Syspro
- [ ] A technician with no van sees a statement that they hold no stock,
      not an empty list
- [ ] A technician whose van is not set is told so
- [ ] A manager sees their allocated technicians, each with van and an
      in-stock count, and tapping one opens that technician's stock
- [ ] A manager with nobody allocated is told that, rather than shown an
      empty list
- [ ] A technician cannot reach another technician's stock. Verify against
      the RPC directly, not only the screen: `app_van_stock` with somebody
      else's staff code must return `allowed: false`

### Allocation still to do

72 of 100 technicians are unallocated, because only two managers could be
derived from OnKey. Allocation is ours now (#139), so this is data entry
rather than an integration problem.

- [ ] Prowalco confirms which manager owns each unallocated technician
- [ ] `SELECT * FROM technician_allocations_unallocated;` returns no rows
- [ ] Each manager signs in and sees their own technicians, and no others

### Two technicians share one van code

`technician_warehouses` has two verified staff codes pointing at warehouse
`NJ`. That is either a genuinely shared van or a mapping error, and it is
the same class of question as #129. Per-technician counts are correct
either way, because `app_team_vans` groups by staff code, but any query
that groups by warehouse code alone will double this van.

- [ ] Prowalco confirms whether that van is shared or one of the two
      mappings is wrong

## Managers of managers (#140)

Hierarchy in place, verified against live data:

| Signed in as | Technicians visible |
|---|---|
| Senior (top of tree) | 100 |
| Senior (second level) | 100 |
| Mid-level manager with two managers under them | 30 |
| Branch manager | 13 |

- [ ] A senior manager sees every technician beneath them, at any depth
- [ ] A branch manager's own scope is unchanged
- [ ] A technician outside the caller's tree is refused by `app_van_stock`
- [ ] The scope reason names both the technician count and the number of
      managers beneath

### The unallocated holder

Technicians nobody has claimed are allocated to a reserved holder that
reports into the tree, so "not yet allocated" is a visible state rather
than an absence. 22 technicians sit there now.

- [ ] A senior manager can see the unallocated technicians and open their
      stock
- [ ] A newly synced technician with no manager lands on the holder rather
      than nowhere (`allocation_sweep_unallocated()`)

### Hierarchy edges to confirm with Prowalco

OnKey's own data says two branch managers report to a third. The remaining
placements were made so the senior people see the whole organisation, and
each is one `manager_reports_to_set()` call to change.

- [ ] Prowalco confirms the reporting lines, in particular which of the
      branch managers report to whom

## Syspro schedule (#142)

- [ ] The stock tab's freshness line stays under ten minutes without
      anyone pressing anything
- [ ] Issue a part to a van in Syspro, and the figure changes in the app
      within about ten minutes
- [ ] Remove a stock line from a van in Syspro, and confirm it disappears
      only after the nightly full load, not before. A rowversion cannot
      see a deletion, and this is the check that the nightly load is
      really covering that gap
- [ ] Pause the schedule for 40 minutes and confirm `syspro_stale` appears
      in the ops alerts

## Roster from OnKey (#141)

`onkey_roster_refresh()` sets who is current from `FIELDOPS - USERS`, with
`FIELDOPS - STAFF` as the fallback for an employee who has no OnKey login.
First run: **83 current, 17 former**, 8 in neither report.

Fetches run nightly at 00:53 and 00:59 UTC, and the refresh at 01:09.

- [ ] A technician marked inactive in OnKey drops out of their manager's
      team on the next refresh, and their old work orders still show their
      name
- [ ] A technician reactivated in OnKey comes back
- [ ] Deleting the report rows and running the refresh changes nothing: it
      must refuse an empty report rather than retire everybody

### Seven vans belong to people who have left

`technician_allocations_former_with_van` lists 7 verified vans whose
technician is now `former`. Their stock is still loaded, because the Syspro
load reads the warehouse register rather than the roster, but nobody's team
view shows it.

That is either a van somebody else now drives, or a stale mapping. Both
matter to the stock figures and neither is safe to guess at.

- [ ] Prowalco says, for each of the seven, whether the van has a new
      driver or the mapping should be retired

## Dispensers on the work order load (#143)

- [ ] Opening a work order with a site fills "Dispensers on site" within a
      moment, allocated dispenser highlighted and marked "This job"
- [ ] Airplane mode: the card shows the last cached dispensers
- [ ] A work order with no site says so rather than loading

## One progressive lifecycle button (#144)

- [ ] Not started: the only lifecycle control is "On my way"
- [ ] On the way: "Start work" as the big button, "Cannot get there"
      beside it
- [ ] "Cannot get there" confirms, puts the job back as not started, and
      sends nothing to the office
- [ ] "Start work" applies the transition and then opens the job card
- [ ] Started: "Complete" as the big button, "Pause" beside it, and Pause
      still requires a reason
- [ ] Paused: "Resume" as the big button, "Complete" beside it
- [ ] Paused for a blocking reason: no lifecycle buttons, the explanation
      shows instead
- [ ] Resume does not open the job card

## Stock tab reshape (#145)

- [ ] The role scope shows bottom-left under the header, the Syspro
      freshness bottom-right, neither inside a card
- [ ] As admin: one collapsible section per manager plus Unallocated,
      counts correct, collapsed by default
- [ ] Tapping a van opens its own screen with search and quantities
- [ ] Opening /van with another technician's staff code as a plain
      technician shows the refusal, not an empty van
- [ ] A technician's own view is unchanged: their van inline with search

## Allocation hierarchy and technician detail (#146)

- [ ] Admin sees the tree in the admin screen, holder as its own group,
      former technicians dimmed with a Former badge
- [ ] Tapping a technician opens the detail page: roster status, van,
      stock counts, manager, and when the allocation last changed
- [ ] As admin: Move to another manager works, and the stock tab groups
      reflect it immediately after the move
- [ ] As a manager (not admin): detail shows, no move control, and calling
      the move RPC directly is refused
- [ ] The old allocation editor is gone from admin

## Reporting tree in the stock tab and admin (#147)

The edges are corrected from the technician master list: the five branch
managers under the mid-level manager, who reports to the senior pair. The
master list itself carries exactly this (five rows naming him as manager,
one row naming his own).

- [ ] The stock tab team view shows the nested tree: senior at top, the
      mid-level manager beneath, the five branch managers under him,
      technicians expanding under each
- [ ] Managers appear at their level whether or not they hold a van
- [ ] The role line reads "Administrator" with nothing after it
- [ ] Tapping a technician in the stock tab opens their van's stock
- [ ] The admin allocation view shows the same tree, and tapping a
      technician opens their detail page
- [ ] The mid-level manager signs in and sees all five branches, 78
      technicians
- [ ] A branch manager signs in and sees only their own technicians

## Dead bottom navigation (#148)

- [ ] Force-quit the app and reopen it TWICE (a downloaded update applies
      on the second launch), then confirm the bottom tabs respond
- [ ] If navigation dies again, note which tap killed it, then open Admin
      and read the "Last app error" card: that is the diagnosis
- [ ] Deliberately break nothing: the "Last app error" card only appears
      after an error has been recorded

## Roster propagation (#149)

- [ ] The morning after next: `select jobname, count(*) from
      cron.job_run_details d join cron.job j on j.jobid=d.jobid where
      jobname like 'onkey-%fetch' or jobname='onkey-roster-refresh' group
      by 1` shows all three fired overnight
- [ ] A deactivation made in OnKey during the day is visible in the app
      the next morning with nobody pressing anything
- [ ] `roster_status_audit` carries one row per flip, and nothing changes
      roster_status without appearing there

## Verification prefill and asset carry from the work order (#151)

The work order screen, the site screen, the dispenser identity screen and
the component register now pass the site id and the work order id along
the whole chain, and the identity screen falls back to the dispenser's
own site link when a caller omits it.

- [ ] Open a work order, tap a dispenser card: the identity screen's Site
      details block arrives prefilled (oil company, site name, address)
- [ ] On a work order that is against a specific asset (green "This job"
      card), start work: the Verification card offers "Start verification
      on MAKE MODEL" and it opens that dispenser directly
- [ ] "Choose a different dispenser" still opens the site's dispenser
      list, and a dispenser opened from there also prefills site details
- [ ] Complete a verification started from a work order, then check the
      job linkage: the certificate record carries the work order id (an
      admin can confirm in verification_records that work_order_id is set)
- [ ] Airplane mode after having opened the work order online: the
      identity screen still prefills site and dispenser from the mirror

## Freshness gate at launch and foreground (#150)

Online means current before the screen settles: a branded "Checking for
changes" state at app open, capped at ten seconds, then the app. Offline
skips the gate entirely.

- [ ] Cold open online: navy "Checking for changes" screen appears
      briefly, then My day shows the current list (verify by changing a
      work order server-side first)
- [ ] Cold open in airplane mode: no gate, cached data immediately, the
      offline banner shows
- [ ] Background the app for over ten minutes, foreground it online: the
      gate runs again, and the list on screen updates without switching
      tabs
- [ ] Background for under ten minutes: no gate on return
- [ ] Switching tabs never shows the gate
- [ ] On a very slow link: the gate yields at ten seconds to the cached
      screen with a "showing your last synced copy" chip that disappears
      when the refresh lands
- [ ] Sign out and back in: the gate runs once after sign-in, and does
      NOT reappear on its own an hour later (token rotation must not
      retrigger it)

## Tasks on the job card (#152)

The OnKey task list now rides the job card bundle, shows on the screen,
and prints on the document's task page. Tasks are fetched from OnKey the
first time a job card is opened online.

- [ ] Open a job card online: the Tasks section fills in (it may say
      "Loading the task list from OnKey" for a few seconds first)
- [ ] Reopen the same job card in airplane mode: the tasks still show
- [ ] A work order whose only task is the "Default Task" placeholder
      shows "No tasks are recorded", not the placeholder
- [ ] Generate the job card document for a work order with a real task:
      the task page prints with the task, its done state and date

## Forced designation and locked site fields (#154, #155)

The flow designation follows Qmax and cannot be tapped; site fields that
arrived from the work order record are read-only.

- [ ] On the dispenser identity screen, enter Qmax 80: the designation
      chip reads "STD: 20/5 L proving measures" and tapping it does
      nothing
- [ ] Change Qmax to 120: the chip flips to "HV: 200 L proving measure"
- [ ] Clear Qmax: the chip says to enter Qmax, and Save is refused
- [ ] Open a dispenser from a work order with a known site: oil company,
      site name and address show as plain text marked "from the work
      order", with no input boxes
- [ ] A field the record does not carry (often telephone) still shows an
      input, and its value saves and prefills next visit
- [ ] Contact person on premises is always editable

## Collapsible hose cards (#156)

- [ ] The components screen shows one collapsed header per hose, with a
      status badge and the product where set
- [ ] Tapping a header opens that hose's form; tapping again collapses it
- [ ] A fully captured hose shows green Complete, a partial one amber
      Components incomplete, one missing its product red, an unselected
      one muted
- [ ] Save & start verification works exactly as before, including the
      incomplete-hose refusal

## Home redesign (#157)

Ships in two stages: everything except the live map arrives as an OTA
update (force-quit and reopen twice); the map needs the new native build
with the Google Maps keys, and until then shows "The map arrives with
the next app build."

- [ ] Home shows the greeting, your town under it (with location
      permission granted), the search field, four number cards, the date
      chip beside the map strip, then the three sections
- [ ] Sections order: In progress (started first, then on the way),
      Upcoming, Complete and stopped
- [ ] The in-progress card's play pill ticks the live time on job in
      minutes; recorded labour shows as "Time recorded" on complete cards
- [ ] Cards show the oil company disc (Prowalco fallback), the two-line
      work required or work performed excerpt, Estimated in hour format,
      Travelled and Spares from the job card, and the overdue tag bottom
      right on a normal white card
- [ ] On-the-way cards show "Distance to site" (straight line times the
      road factor) when position is known
- [ ] Search filters the list by site, company, reference or work text
- [ ] The number cards show the day's totals and reset on the SA day
- [ ] Measures alert, certificates in progress, archived note and the
      team section still render below the work list
- [ ] AFTER the native build: the map strip shows your position and the
      surrounding pins with distance chips, overdue pins chipped red

## Full-screen map with pin cards (#158)

Needs the 0.2.0 native build; on older builds both the strip and the
full screen show the placeholder text.

- [ ] Tapping the Home map strip opens the full map with every open
      work order pinned and your position dot
- [ ] Tapping a pin raises that work order's card, with the full work
      text and the status line, plus distance to site when position is
      known
- [ ] Tapping the card opens the work order; tapping the map behind it
      dismisses; the close button dismisses
- [ ] Overdue pins keep their red day chips on the full map

## Work order detail redesign (#159)

Arrives as an OTA update (force-quit and reopen twice). The map strip on
the pre-work view needs the 0.2.0 native build, like Home.

- [ ] Before work starts (not started or on the way): hero card shows
      the oil disc, status icon, site name and address, the work
      required excerpt, Estimated duration, Complete by, Distance to
      site when position is known, and the map strip with a Navigate
      pill that opens Google Maps directions
- [ ] While started or paused: the "Job card, visit 1" section sits
      inline with the four visit numbers (distance, labour, OT 1.5,
      OT 2.0), the work performed note, the spares count line, and
      "Open the full job card"; numbers persist when you leave a field
- [ ] The gate: Complete and Pause render dimmed with "Fill the job
      card first" until the job card is filled; tapping them anyway
      explains exactly what is missing (Complete needs a visit with
      labour or distance AND a work performed note; Pause needs the
      note only)
- [ ] Once filled, Complete and Pause return to full strength and work
      as before (pause reasons sheet, stand-down confirmation)
- [ ] After completion: three figure cards (Travelled, Labour, Spares),
      the Spares booked list itemised, and once signed a PDF row
      ("Job card, signed, Accepted by ...") that opens the share sheet
      with the finalised job card PDF; before signing, a "Job card and
      sign-off" button opens the job card screen
- [ ] Past work at this site shows up to six earlier jobs (reference,
      date, what was done) on the pre-work and completed views
- [ ] Dispensers named on the job, verification launch, divergence and
      rejected cards all still work; no dispenser selection is forced

## Sign-off before Complete (#162)

Arrives as an OTA update (git pull on the Metro laptop, then reload).

- [ ] On a started job, the work order page carries the whole job card:
      visits (with Add a visit), work performed, the Spares booked list
      with a "Book spares" button, and a "Client sign-off" card
- [ ] "Book spares" opens the spares page: the stock pick list, editable
      quantities, remove; changes show back on the work order page
- [ ] "Client sign-off" opens the sign-off page: client name, contact
      details (both required before capture), the signature pad
      hand-off, then "Sign off" seals the card
- [ ] The client can sign while the job is still started or paused
- [ ] Complete stays locked ("Client sign-off needed") until the card
      is sealed; tapping it anyway offers "Sign off now"
- [ ] With the visit numbers, the note and the sign-off all in place,
      Complete moves the job straight to signed off in one tap
- [ ] A job stopped before signing (the old flow) still shows "Client
      sign-off" on the completed view, and sealing there moves it to
      signed off exactly as before
- [ ] The signed job card PDF shows the client's contact details next
      to their name
- [ ] The separate job card screen is gone; work tasks from OnKey show
      on the work order page while the job is active

## Sign-off completes the job (#165)

Amends the #162 flow: Complete and sign-off are one act. Same OTA path.

- [ ] On a filled job card (visit numbers and the work performed note),
      tapping Complete opens the sign-off page instead of stopping the
      job
- [ ] Sealing the sign-off moves the job straight to signed off: no
      further tap, and the work order page shows the completed view on
      return
- [ ] On an unfilled card, Complete still explains what is missing and
      stays locked
- [ ] A job stopped before signing (older data) still shows "Client
      sign-off" on the completed view and sealing there signs it off

## Incomplete watermark and handed-back sign-off (#166)

Same OTA path.

- [ ] Pause with a handed-back reason (one that cannot be resumed): the
      confirmation says the client signs the incomplete card, and after
      pausing the sign-off page opens
- [ ] Sealing there says the job stays with the office; the work order
      stays paused, not completed
- [ ] The paused view shows "Job card PDF (incomplete)"; every page of
      the PDF carries the diagonal Incomplete watermark
- [ ] If the client was unavailable, the paused view keeps the "Client
      sign-off" button until it is done
- [ ] A sealed card locks the visit fields, the note, add and remove
      visit, and Book spares
- [ ] Completing a job normally still prints a clean PDF with no
      watermark

## Verification only on calibration work orders (#167)

Same OTA path. The flag rides the work order feed, so pull refresh on
Home once after updating.

- [ ] A [TEST] work order still shows Dispensers on site and the
      Verification section
- [ ] A real calibration or verification work order (work required
      mentions calibration or verification) shows both sections
- [ ] A non-calibration job (for example a leak detector PM or a repair
      call) shows neither

## Sites tab redesign (#168)

Same OTA path. Pull refresh once on the tab to fetch the full register.

- [ ] The tab lists your active sites on top (job count pills, most
      jobs first) and every register site underneath, alphabetically
- [ ] The oil company chips filter both sections; All clears; the
      chips carry the brand discs
- [ ] Search narrows by site name, customer, address or site number
- [ ] Scrolling the full register (about 2,900 sites) stays smooth
- [ ] Tapping any site opens its documents and history, even with no
      work order there

## Stock tab restyle (#169)

Same OTA path. Visual only; nothing functional changed.

- [ ] The technician view shows the On board heading outside the card,
      the navy van disc with "Your van" and the scope line, the shared
      search style, and part codes in mono with quantities in the
      heading face
- [ ] The manager view shows the Teams heading outside the restyled
      card; the collapsible tree and van screens work as before
- [ ] The meta line (scope left, Syspro freshness right) still sits
      under the header

## Map pins repaint, sites and history widen (#170, #171)

Same OTA path; pull refresh once on Sites.

- [ ] Every map pin shows its mark (droplet fallback included) on the
      strip and the full map, including straight after a fresh app start
- [ ] The Sites tab loads the full register (about 2,900 sites) after
      one pull refresh, even during a busy sync period
- [ ] Past work at a site includes other technicians' completed OnKey
      jobs, not just work done through this app

## Map card button, Total render, sites merge fix (#174, #173, #171)

Same OTA path; pull refresh once on Sites.

- [ ] The map pin card carries a green "Open work order" button that
      opens the job; dismiss still works
- [ ] Total sites show the TE beam on their discs (the gradients now
      render)
- [ ] The Sites tab loads all 2,872 register sites with their real
      names after a pull refresh

## Heading typeface: full-width Barlow (#177)

OTA update; force close and reopen the app twice so the new font
package loads.

- [ ] Headings across the app (greeting, card titles, site names, tab
      labels, quantities) render in full-width Barlow, visibly wider
      than the old Semi Condensed cut
- [ ] Long site names on Home, Sites and Stock cards still fit
      acceptably (wrap or ellipsis, no clipped or overlapping text)
- [ ] The navy app bar titles render in the new face, not a fallback

## Sign queue drain race (#178)

OTA update. Best reproduced with the certificate that is currently
stuck retrying.

- [ ] The stuck certificate (PWC-JHB-000023-00) finishes signing on its
      own within a minute of opening the app with connectivity
- [ ] Signing status no longer shows "Illegal state transition
      UPLOADING -> UPLOADING"; on a clean sign the steps tick through
      to Synced
- [ ] Kill the app mid upload (airplane mode off, tap sign, force close
      immediately): on relaunch the certificate still issues exactly
      once

## Discard unissued certificates (#182)

OTA update.

- [ ] A draft verification's results screen offers "Discard draft"; after
      the confirm, the certificate disappears from the Home in-progress
      card and its work order's verification can start fresh
- [ ] The signing status screen of a queued certificate offers "Discard
      certificate" with the stronger warning; discarding removes it and
      no further retries appear
- [ ] While a certificate is uploading, and once it is signed or synced,
      no discard button is shown

## Certificates attach to their work order card (#183)

OTA update.

- [ ] A certificate started from a work order shows as an inset row
      under that work order's Home card, titled with the dispenser make
      and model, then serial number and certificate number; the site
      name is not repeated
- [ ] Tapping the row resumes the certificate; Retry now, last saved
      and the draft trash can still work from the attached row
- [ ] The old standalone section appears only when a certificate has no
      matching work order card on screen

## Maps frame every pin (#184)

OTA update.

- [ ] The Home map strip zooms out far enough that every open work
      order pin is inside the frame, however far away, plus your own
      position
- [ ] The full map still frames everything and pans/zooms as before

## Date chip and map overlap (#185)

OTA update.

- [ ] The green chip shows the short day name (Wed), date and month,
      all fully visible
- [ ] The map strip overlaps the chip's right side with a clean rounded
      seam; tapping the overlapped area still opens the full map

## Green map border, larger chip text (#186)

OTA update.

- [ ] The Home map strip (and its placeholder when no position is
      known) carries a thin brand-green border; the full map does not
- [ ] The chip's day and month lines are slightly larger and fully
      visible beside the overlapping map

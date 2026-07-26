# Architecture v2 — offline-first field app on Supabase

Status: **agreed spec** (owner interview, 2026-07-25 — issue #64).
Where this document differs from CLAUDE.md's original brief, **this document
wins**. Implementation happens in phases; each phase opens its own issue
(CONSTITUTION Article 1) when it starts.

## 1. Why v1's shape is wrong

v1 was designed assuming the backend would talk to OnKey live, so every app
read went phone → FastAPI (Render free, cross-continent) → Supabase
(6–8 sequential queries, N+1 on dispensers, per-request alias aggregate).
Opening a work order cost ~3 s of pure round trips for a few KB of data.
The WOE001 sync made that shape obsolete: **Supabase already holds a
5-minute-fresh copy of everything** — the middleman read path is waste.

## 2. Ground truth (owner interview)

| Fact | Consequence |
|---|---|
| ~150 daily users: technicians, managers, admin | Three roles, RLS-enforced |
| Remote forecourts, little/no signal | **Offline is a hard requirement** |
| Cheap Android tablets, strictly one per technician | Android-first; no biometric assumption; device = possession factor |
| Client no longer signs | Client-signature flow removed; sealed cert + auto-email is the deliverable |
| Scope = NRCS verification certificates only | No general job-type modelling (future option) |
| WOE001 SOAP polling is permanent; no write-back | The 5-min sync is production infrastructure |
| Certificates retained indefinitely, inspected on demand | Write-once archive, per site+dispenser history, starts at go-live |
| A dispenser can move between sites | Relocation clears identity assumptions (archived, never deleted) |
| Managers: whole-company visibility, pre-filtered to their team | RLS allows manager read; UI defaults to allocated technicians |
| Admin sets up technicians, tech→manager allocation, proving measures | No site/equipment admin yet |
| Equipment master source does not exist yet | On-site identity completion stays; master import is a future feed |
| ~50 certificates/day assumed | ~13k/yr, ~5–7 GB/yr PDFs — trivial |
| **PoC stays on free tiers** (Supabase free + Render free) | No region migration now; offline-first hides latency; paid SA-local hosting is a post-PoC item |

## 3. Target architecture

### 3.1 Tablet app (Expo, Android-first)
- **Local SQLite mirror is the source of truth for every screen.** Work
  orders, sites, equipment, technician profile + proving measures, and the
  technician's own certificate archive render from local data — zero
  spinners, zero network in the UI path.
- **Outbox pattern for all writes**: results, on-site equipment identity,
  site gap-fills, issued certificates queue locally and replay in order when
  signal returns. The existing sign-queue state machine generalizes into
  this single sync engine.
- **Sync cadence**: full pull at sign-in; delta pull on app foreground, on
  connectivity regained, and ~every 15 min while online. Mid-day work-order
  changes arrive at the next signal window (the server copy is at most
  5 min behind OnKey).
- Delta sync uses `updated_at` cursors served by SQL functions — one round
  trip per table, not per row.

### 3.2 Supabase (the data platform — the app talks to it DIRECTLY)
- Postgres: OnKey registers (`onkey_*`), canonical store, certificate
  index, append-only audit. Auth: existing PKCE sign-in (the Supabase JWT
  is what PostgREST accepts — no new auth). Storage: sealed PDFs,
  write-once, indefinite retention.
- **RLS for three roles**: technician (own record, own work, own certs),
  manager (company-wide read, team-scoped by default via the tech→manager
  allocation), admin (setup tables). Technician PII (names/emails, POPIA)
  is exposed only per these policies.
- **SQL functions** replace backend logic evaluated next to the data:
  "my work orders" (incl. demo-alias → busiest-technician resolution,
  currently re-aggregated on every request), delta cursors, insights
  aggregates.

### 3.3 Signing service (the only server code left in the request path)
Invoked solely at the moment of issue — the one moment latency is
acceptable:
1. verify the device signature (possession factor) and session (first factor)
2. re-validate the payload against the shared schema + PDF text-layer crosscheck
3. seal PAdES + RFC 3161 timestamp
4. write the PDF to Storage (write-once) and index it
5. dispatch the customer email with the sealed PDF — **server-side, so the
   emailed copy is byte-identical to the stored, sealed document**; what the
   technician previewed is the same rendered document pre-seal

The email pipeline is built **dormant** for the PoC: sending activates when
`@prowalco.co.za` DNS access (SPF/DKIM) is granted post-approval.
This service also hosts the 5-min WOE001 SOAP sync. PoC hosting: current
Render free service, reduced to these duties.

### 3.4 Web app (managers + admins)
Same Supabase Auth + RLS. Managers: certificate search / view / re-send,
progress analytics, default-filtered to their allocated team with a
company-wide filter. Admin: technician records, tech→manager allocation,
proving measures. External users: out of scope.

### 3.5 Insights (all users, RLS-scoped — extends #56)
An Insights tab for every role, where RLS shapes what each sees:
technician → their own throughput/outcomes; manager → team (default) and
company; admin → everything. Served by SQL aggregate functions, cached into
the device mirror like other reads.

## 4. Security model changes
- **2FA = something you know (account sign-in) + something you have (the
  registered device key, #51/#52)** — `DEVICE_BINDING_ENFORCE` flips on.
  Biometric/PIN remains a local convenience gate where hardware exists,
  never a requirement.
- One technician per tablet, one tablet per technician. Device transfer =
  admin approves re-binding; the old device is revoked.
- Client signature capture is deleted. Trust anchor: technician's
  cryptographic signature + TSA + device binding + audit trail.

## 5. Data rules
- **Dispenser relocation**: a transfer event archives the component register
  and identity fields (audit — never deleted) and resets them blank for
  re-entry at the new site. Historic verifications stay attached to the
  site+dispenser combination they were issued under.
- **Certificate archive**: begins at go-live. Historic paper certificates
  may be imported later (out of scope now).
- **Equipment master data**: no source exists today; on-site completion
  remains the capture path until the owner provides a feed.

## 6. What gets deleted from v1
- All Render-proxied read endpoints (app reads Supabase directly)
- The client draw-signature flow
- The per-request busiest-technician aggregate (becomes a SQL function)
- The biometric-gated signing assumption

## 7. Phase plan (each phase = its own issue when started)
1. **Direct read path** — RLS policies + RPC functions; the app syncs
   straight from Supabase; Render leaves the read loop. *Biggest immediate
   speed win, free-tier compatible.*
2. **Offline mirror + outbox** — one SQLite schema on device; every screen
   goes local; existing caches and the sign queue fold in.
3. **Signing v2** — device binding enforced as the second factor; client
   signature removed; dormant email pipeline.
4. **Archive & history** — certificate index + per-site/dispenser history
   views in-app.
5. **Insights tab** — all users, RLS-scoped (with #56).
6. **Roles in-app** (amended 2026-07-26): manager/admin roles, view-as
   (replaces the demo-alias mechanism), measures-compliance reporting —
   built into the existing app. The dedicated web app is DEFERRED until a
   desk-based need is proven; the same screens export to web via Expo when
   it is.
7. **Relocation** (resolved 2026-07-26, owner decision): no transfer-event
   machinery. Retire at the old site + add at the new site IS the flow.
   Invariants enforced (#74): archived dispensers and their certificates
   stay at the site they were archived at; a re-linked equipment number
   appears at the new site as a blank-identity seed only.

## 8. Deferred (post-PoC approval)
Paid hosting near South Africa (Supabase `af-south-1` + signing service in
Johannesburg — the planned end-state once the PoC is approved),
`@prowalco.co.za` sending domain, historic certificate import, OnKey
write-back, external user access.

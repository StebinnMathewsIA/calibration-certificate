# Work-order management phase: execution plan

Status: planned 2026-08-01 with the owner. Sources: the Field Technician
App Requirements Checklist (44 current-state FRs proven in the legacy
Pragma Work Manager app + 45 target-state BLs), the 2018 Work Manager
training slides, and docs/ONKEY-WEBSERVICES.md. Owner-supplied
constraint: **OnKey writes may target ONLY the seven [TEST] work orders**
provided by the owner; their codes live in the `ONKEY_WRITE_ALLOWLIST`
environment variable on the signing service, never in this repo (the
screenshot also carries technician names, which stay out per POPIA).

## What we already have

The certificate side of this phase is largely built: sealed verification
and rejection certificates, the archive, per-site history, the test-plan
registry, and the document-type registry that a job card can slot into.
The app also already has: a per-technician work list grouped by status
(from the 5-minute WOE001 sync), site navigation with the mini map
(FR-WO-04), and offline-first infrastructure (mirror + outbox) that the
lifecycle actions will ride. BL-DOC-07 (calibration certificates with
digital signature and two-factor) is DONE.

## Scope decision

This phase reproduces **Part A of the checklist (the legacy app's
current state)** inside our app, with write-back to OnKey, because that
is what technicians demonstrably used daily. Part B (target state) is
catalogued at the end; each item needs an owner decision before it
becomes a ticket, and several (Syspro inventory, payroll, SOS/comms) are
separate systems, not app features.

## Solidified build plan (2026-08-01)

Owner commitments: priority 1 and 2 reports from ONKEY-REPORTS-SPEC.md
WILL be authored; priority 3 is best effort. Owner decisions locked in:
OnKey I/O (reads AND writes) is Supabase-native (pg_cron + pg_net +
Edge Functions; the contracts are hand-built SOAP from the introspected
WSDLs); Render remains ONLY for PAdES sealing, kept warm by a
keep-alive ping since the sync no longer wakes it; job cards keep the
drawn client signature; mandatory import columns are discovered by
trial and error against per-record RecordFailures; the same OnKey
account serves reads and writes.

### Workstream A: Supabase-native OnKey platform (no dependencies, starts first)
1. Migration: enable pg_cron and pg_net; `onkey_outbox` (kind, payload,
   wo_code, state pending/sent/failed, record_failures, onkey_record_ids);
   per-report staging tables with content-hash dedupe (the WOE001
   pattern, generalized to any ReportCode); config table with the
   DRY-RUN flag (default on) and the write allowlist (test codes only,
   values via Supabase secrets/config, never the repo).
2. Edge Function `onkey`: SOAP envelope builder from the introspected
   contracts (Logon, ExportData, the WorkOrderImport operations,
   LogOff), session per invocation, SessionExpired re-logon, both
   response error channels surfaced. Owner one-time step: copy the four
   ONKEY_* values from Render env into Supabase Edge Function secrets.
3. Read pipeline port: WOE001 fetched by the Edge Function side by side
   with the Render sync until the derived registers match, then the
   GitHub Actions cron flips to a Render keep-alive ping only.
   Derivation logic moves into SQL functions (it is mostly SQL already).

### Workstream B: device lifecycle (no dependencies, parallel with A)
- #95: start/pause/resume/stop machine, offline-first, pause-reason
  rules, SLA timestamps, work list filters (All / Started / Not
  Started / Completed). Purely local until the write path opens.
- #100 job card (client signature pad returns, per owner) and #101
  attachments (app + Supabase Storage side) are also not report-gated
  and follow straight after.

### Workstream C: report-gated, in arrival order
- PWR-WO01 lands: full work-list fields (#94 closes), closed-status
  and [TEST] visibility, created-WO code resolution.
- PWR-REF01 lands: status mapping table for #96 built from real state
  codes; first ever write = a NO-OP status change (a test WO set to its
  current state) to validate codes; then the test-WO factory (#104)
  performs the first Insert; then lifecycle write-back (#96) goes live
  end to end on factory-created test WOs.
- PWR-WT01 lands: labour capture (#98).
- PWR-REF02 lands: feedback with real failure-analysis pickers (#97).
- PWR-INV01 lands: spares step 2, warehouse and item search (#99;
  step 1 free-coded entry ships un-gated with #97).
- PWR-STF01 / PWR-AST01 land: manual technician/location master uploads
  retire in favour of OnKey-sourced registers; full per-site asset
  lists.

### Workstream D: close-out bridge
- DocumentLinkImport introspection runs from Render's network path
  regardless of PWR-DOC01 (its WSDL refuses our sandbox).
- #102: on certificate issue, attach the sealed PDF reference and drive
  the close-out transition; rejection issues raise the linked repair WO
  (#104 part 2). Gated on the #96 mapping plus DocumentLink.

### Priority-3 fallbacks (if those reports never arrive)
- Without PWR-DOC01: attachment success is verified from the import's
  RecordSuccesses plus an owner spot check in the OnKey UI; the app's
  Documents tab lists our own Storage copies, which we hold anyway.
- Without PWR-WO02: our append-only audit of every write plus
  PWR-WO01's StatusChangedOn column serves as transition verification.

### Cutover checklist (end of phase)
WOE001 retired after side-by-side parity; master file uploads retired
after PWR-STF01/AST01 parity; GitHub cron reduced to the Render
keep-alive; dry-run flag off only per explicit owner instruction, and
the allowlist stays even then until Prowalco signs off production
write-back.

## Becoming the system of record (owner direction, 2026-08-01)

The owner intends to eventually take control of the asset-management and
work-order process: their own hosted database as the system of record,
OnKey retired. That system is NOT built now, but these decisions bind
TODAY's build so tomorrow is a swap, not a rewrite:

1. **The outbox stores domain events, never SOAP payloads.** Entries are
   intents ("work order started", "labour recorded", "close out with
   certificate X") translated by an OnKey ADAPTER into import calls.
   Replacing OnKey means writing a native adapter (SQL writes into our
   own tables); the app, the outbox and the audit trail never change.
2. **Our own work-order entity with our own IDs.** Lifecycle state,
   feedback, labour and spares hang off OUR `work_orders` record (uuid,
   `source: onkey | native`, `external_ref` carrying the OnKey code).
   OnKey codes are foreign references, not primary keys. Native-era and
   OnKey-era work orders coexist exactly as manual-era and prefill-era
   certificates already do.
3. **Our lifecycle states are the durable model.** The device state
   machine's states are canonical; OnKey's UserDefinedStateCodes are an
   adapter mapping (already the #96 design). At cutover the mapping is
   dropped and the states remain.
4. **Raw report snapshots are never pruned.** Every Analyser Report
   lands in an append-only content-hashed snapshot table. That archive
   is the migration corpus: the full history of work orders, statuses,
   assets and staff needed to seed the native system without depending
   on Pragma's cooperation at cutover. Storage cost is trivial.
5. **Portability guardrails.** Everything stays plain Postgres,
   reproducible from the SQL migrations in this repo (CI already proves
   it); Storage objects and Edge Functions have self-host equivalents
   (Supabase is open source; the planned post-PoC move to a paid or
   self-hosted region is the same motion). No feature without an exit.
6. **The canonical-store rule extends to every new entity.** Our record
   wins over the OnKey seed, with source flags, for work orders and
   tasks exactly as it does for sites and dispensers today. The day the
   OnKey feed stops, the canonical store simply IS the register.

What is deliberately NOT built until the owner schedules it: the
planner/SMA side (creating and allocating work company-wide, SLA
engines, queues) and the migration of Pragma-side configuration
(states, importances, failure registers) into owned reference tables.
Both become straightforward once rules 1 to 6 hold.

## Original stages and tickets (superseded by the solidified plan above)

### Stage 0: access and safety rails (blocks everything)
- **#93 OnKey write client + hard allowlist.** Write-capable integration
  account (UserName/ConnectionName/rights) from Prowalco; zeep import
  client alongside the existing export client; EVERY import call refuses
  any work order not in `ONKEY_WRITE_ALLOWLIST`; every write audited.
  Confirm the exact [TEST] WO codes, the status/queue model (the test
  list shows Completed and Costing Complete states we do not sync
  today), and obtain the Interface Tool Import Templates for the
  WorkOrder imports.
- **#94 Read coverage for the work list.** Gap analysis of WOE001
  against FR-WL-02/FR-WO-01 (due/complete-by date, work-required text,
  importance/SLA class, GL code, asset description, WO location GPS).
  Missing fields mean a new/extended Analyser Report authored in OnKey
  by Prowalco: owner lead time.

### Stage 1: lifecycle on the device
- **#95 Work-order lifecycle state machine.** Tap to Start (begins SLA),
  Pause with mandatory reason (Incomplete for Spares and Referral are
  not technician-resumable, per FR-WO-08), Resume, Stop (ends SLA,
  unlocks sign-off). Persisted locally, offline-first, timestamps kept
  for feedback (FR-FB-01). Work list gains All / Started / Not Started /
  Completed filters with counts (FR-WL-03).
- **#96 Status write-back v1.** Our lifecycle events map to OnKey
  status/queue changes via ImportWorkOrderChangeStatusAndQueue, queued
  through the outbox, replayed online, allowlist-enforced. The mapping
  table is data (like the test plans), agreed with Prowalco from #93's
  answers.

### Stage 2: what the technician records
- **#97 Work feedback.** Work performed free text, start/complete times
  auto-filled from the lifecycle, simple failure analysis; explicit
  save; write-back to the WO.
- **#98 Labour capture.** Normal vs overtime hours per WO; write-back
  via the Work Task Labour import.
- **#99 Spares consumption v1.** Line items (category, code/description,
  quantity, unit) with edit/delete and a running count. Stock-item
  warehouse/item master search needs an inventory read from OnKey:
  ships as free-coded entry first, master-data search second.

### Stage 3: documents
- **#100 Job card document type.** The second consumer of the document
  registry: WO summary, feedback, spares, labour, technician signature
  (cryptographic, as certificates) and client name. DECISION for the
  owner: does the client still draw a signature on job cards, or does
  the sealed-and-emailed model replace it here too (as it did for
  certificates)?
- **#101 Attachments.** Photos/files/voice notes against a WO, named
  before storing, listed under a Documents view, deletable only by
  admin. Stored in Supabase Storage; OnKey DocumentLink write-back once
  #93 confirms what DocumentLink actually accepts.
- **#102 Certificate-to-WO close-out.** The bridge between the two
  halves: on certificate issue, attach the sealed PDF reference to the
  OnKey WO and drive the close-out status transition. Test-WO-only until
  Prowalco signs off the flow.

## Part B backlog (owner decisions pending)

Near-fit extensions our stack makes cheap when wanted: accept /
on-my-way states (BL-WE-01/02) as extra lifecycle states in #95's
machine; travel time / time-on-site (BL-WE-06..08) derivable from
lifecycle + GPS timestamps; geofenced arrival (BL-WE-04); structured
feedback forms (BL-WE-12/13); follow-up work capture (BL-WE-10, maps to
OnKey work requests); camera naming and scanner (BL-DOC-04/05, partially
present); documentation packs by email (BL-DOC-13, rides the dormant
email pipeline); KPI view (BL-PM-01, an Insights extension). Separate
systems, not this app: Syspro inventory reconciliation (BL-INV-06),
payroll integration (BL-HR-07), SOS/messaging (BL-COM-*). HR self-service
(BL-HR-01..06) and stock operations (BL-INV-02..05) need a product
decision on whether this app is the vehicle at all.

## Test protocol

All write-path testing happens exclusively against the seven owner-
designated [TEST] work orders, via the allowlist. Reads stay unrestricted
(they are read-only). Every OnKey write lands in the audit log with the
import service, payload summary and OnKey RecordIds. A CI-style dry-run
mode (log the import payload, skip the call) ships before the first real
write.

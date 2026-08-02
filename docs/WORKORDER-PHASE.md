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

## Solidified build plan (2026-08-01, revised after senior review 2026-08-02)

Owner commitments: priority 1 and 2 reports from ONKEY-REPORTS-SPEC.md
WILL be authored; priority 3 is best effort. Supabase Pro is a given.
Owner decisions locked in: OnKey I/O (reads AND writes) is
Supabase-native (pg_cron + pg_net + Edge Functions; hand-built SOAP
from the introspected WSDLs); Render remains ONLY for PAdES sealing,
kept warm by a best-effort keep-alive (GitHub schedules can slip, so an
occasional ~30 s cold first seal remains possible until Render goes
paid; recorded in TESTING.md, not a bug); job cards keep the drawn
client signature; mandatory import columns are discovered by trial and
error against per-record RecordFailures; the same OnKey account serves
reads and writes.

### Binding write rules (from review)
- **ExternalReference carries our event UUID on every import that
  supports it** (work orders, labour, spares). Retry logic queries by
  it (PWR-WO01/WT01) before re-sending, so a lost response can never
  double-create or double-book. This is the idempotency mechanism; the
  stored OnKey RecordIds are the audit trail, not the guard.
- **Domain events carry a schemaVersion** from day one: the outbox
  persists across OTA updates, exactly like the sign queue.
- **Reconciliation policy**: planners keep changing work orders inside
  OnKey while technicians work offline. On every sync, OnKey's state is
  recorded beside ours; divergence (reassigned, cancelled, completed by
  someone else) is SURFACED to the technician, and queued events whose
  target moved land in a **dead-letter state visible to managers**,
  never a silent drop or a blind apply.
- **Cron-to-function trust**: the Edge Function endpoints require a
  shared-secret header (JWT verification off); the secret lives in the
  Edge secrets and inside the cron job definition, nowhere else.

### Workstream A1: SOAP skeleton and first proof (days, starts first)
1. Migration: enable pg_cron and pg_net; `onkey_outbox` (domain events:
   kind, schemaVersion, payload, target wo_code, event uuid, state
   pending/sent/failed/dead_letter, record_failures, onkey_record_ids);
   `sync_runs` bookkeeping; config with the DRY-RUN flag (default on)
   and the write allowlist (values via Supabase secrets, never the repo).
2. Edge Function `onkey`: envelope builder for Logon/LogOff plus the
   WorkOrderImport operations, session per invocation, SessionExpired
   re-logon, both error channels surfaced. **Golden transcripts**: the
   working Render client logs a handful of real request/response XML
   pairs once, and CI pins the Deno builder to them.
3. Proof ladder, in order: connectivity smoke (Logon/LogOff only); the
   NO-OP status trial (a test WO set to its current state) validating
   state codes from PWR-REF01; the test-WO factory's first Insert.
   Owner one-time step before any of it: copy the four ONKEY_* values
   from Render env into Supabase Edge Function secrets.

### Workstream A2: read-pipeline port (trails A1, blocks nobody)
- One chunk per invocation (Edge Functions have hard wall-clock
  limits; the Render sync's long single-process loop does NOT port
  as-is), driven by `sync_runs` so a killed backfill resumes.
- WOE001 runs side by side with the Render sync until a **scripted
  parity comparison** (same content-hash sets over the same window,
  register diff query) passes repeatedly; the Render path stays
  callable as rollback for two weeks after the flip; only then does the
  GitHub cron become keep-alive-only. Derivation stays in SQL.
- **Observability is part of A2, not an afterthought**: an admin
  Insights card showing last-sync age, outbox depth, failure and
  dead-letter counts, replacing the visibility the GitHub cron logs
  provided.

### Workstream B: device lifecycle (no dependencies, parallel)
- #95: start/pause/resume/stop machine on OUR work-order entity (own
  uuid, source flag, OnKey code as external_ref), offline-first,
  pause-reason rules, SLA timestamps, work-list filters. Purely local
  until A1's proof ladder completes.
- #100 job card (client signature pad returns) and #101 attachments
  (app + Storage side) follow, under the storage rules below.

### Workstream C: report-gated, in arrival order
- PWR-WO01: full work-list fields (#94 closes), closed-status and
  [TEST] visibility, created-WO code resolution, and the read-back that
  the ExternalReference idempotency check depends on.
- PWR-REF01: the #96 status mapping table from real state codes, then
  the no-op trial, then lifecycle write-back live end to end on
  factory-created test WOs.
- PWR-WT01: labour (#98). PWR-REF02: failure-analysis pickers (#97).
- PWR-INV01: spares step 2 (#99; free-coded step 1 ships un-gated).
- PWR-STF01 / PWR-AST01: manual master uploads retire after their own
  scripted parity check.

### Workstream D: close-out bridge
- DocumentLinkImport introspection runs from Render's network path
  regardless of PWR-DOC01.
- #102: certificate issue attaches the sealed PDF reference and drives
  close-out; rejection issue raises the linked repair WO (#104). Gated
  on the #96 mapping plus DocumentLink.

### Write scope narrowed (owner, 2026-08-02): CHANGE ONLY
We modify existing open work orders; we do NOT create work orders or
work requests. #104 (creation and the test-WO factory) is parked, and
so is the rejection-driven repair WO. The allowlist and dry-run rails
are unchanged. Because we can no longer mint our own test work orders,
Prowalco must place at least one designated [TEST] work order into an
OPEN status, assigned to a test technician, before the lifecycle
write-back can be proven end to end.

### Test-WO factory hygiene (#104, PARKED per the write-scope decision)
Created test WOs appear in Prowalco planners' dashboards: unmistakable
[TEST] marker, designated test staff code and site, a volume cap, a
verified cleanup path (Action Delete trialled first), and the owner
warns the planning team before the first run.

### Priority-3 fallbacks (if those reports never arrive)
- Without PWR-DOC01: attachment success verified from RecordSuccesses
  plus an owner spot check in the OnKey UI; the Documents tab lists our
  own Storage copies, which are primary anyway.
- Without PWR-WO02: our append-only write audit plus PWR-WO01's
  StatusChangedOn column serve as transition verification.

### Cutover checklist (end of phase)
WOE001 retired after scripted parity; master uploads retired after
PWR-STF01/AST01 parity; GitHub cron reduced to the Render keep-alive;
dry-run off only per explicit owner instruction; the allowlist stays
even then until Prowalco signs off production write-back; off-site
document replication running BEFORE production write-back is declared.

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

## Document storage (binding rules, from the storage review)

Three classes: sealed legal documents (certificates, rejection
certificates, job cards: the existing write-once, hash-recorded,
audited pipeline, unchanged); evidence attachments (photos, files,
voice notes: named at capture, immutable once uploaded, admin-only soft
delete); working documents (PTW and checklists later: editable until
completed, then frozen into class 2).

- One `documents` registry table (type, storage path, sha256, size,
  mime, creator, anchors to our work order / site / dispenser /
  certificate). Certificates keep their table; a **union view** is the
  single read path for every Documents surface.
- **Our storage is primary; OnKey receives references** (DocumentLink),
  never the other way around.
- **Separate media lane**, not the domain-event outbox: its own retry
  pacing so a large photo on poor signal never blocks a tiny lifecycle
  event. Events reference documents by id + hash and fire only when
  their referenced documents are server-side; ordering is per work
  order.
- Upload permission is minted by an Edge Function applying OUR role
  logic (storage RLS path policies cannot express app_roles/view-as),
  as short-lived signed URLs issued at DRAIN time, not enqueue time.
- **Content-addressed attachment paths** (sha256 in the path): retries
  idempotent, duplicates free.
- Device policy: local media evictable once uploaded and hash-verified;
  sealed PDFs kept; last N days of media retained. EXIF stripped at
  capture; location only via the existing consent flow.
- Soft delete: object retained, registry row records who/when/why,
  hidden from technician and manager views, visible to admin and audit.
- Integrity sweep: a pg_cron job re-verifies stored hashes (Supabase
  Storage has no true WORM; our immutability is code plus audit).
- Per-file size caps (compressed photos, capped voice notes), MIME
  validated server-side at registry insert.
- Storage usage watchdog feeding the admin Insights card (hygiene under
  Pro's 100 GB, not an emergency).
- **Off-site object replication is a pre-production requirement**:
  database backups never cover Storage objects, and these are legal
  documents held indefinitely.

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

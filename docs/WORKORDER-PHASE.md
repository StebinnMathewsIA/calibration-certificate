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

## Stages and tickets

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

# Phase recalibration after the OnKey read surface landed

Written 2026-08-03, after authoring and probing fourteen Analyser
reports against the live system. This revisits WORKORDER-PHASE.md and
PLATFORM-VISION.md with evidence instead of assumption. It does not
replace them; it records what survived, what moved, and why.

## What held up

Worth stating first, because most of it did.

- **The offline-first architecture and the canonical-store rules.** Our
  uuid is the key, OnKey's code is `external_ref`, lifecycle is ours,
  snapshots are never pruned. Nothing found contradicts this, and one
  finding strongly supports it (see asset register below).
- **The lifecycle state machine.** Designed from a conversation about
  how technicians work. OnKey's progress log turns out to record the
  same events with the same shape, and its transition register forbids
  resuming from Incomplete-for-Spares exactly as we do.
- **Change-only write scope.** Vindicated: 10 of 25 transitions
  observed in production are not in the target-status register, so the
  system tolerates far more than it documents. A narrow scope is the
  only defensible one.
- **The signing flow, the certificate content, the measures register.**
  Untouched by any of this.

## What changed, with evidence

### 1. We are the equipment system of record, and this cannot be parked

PLATFORM-VISION.md deferred asset management. That is no longer a
choice we get to make.

`astAssets` is a per-site maintenance checklist, not an equipment
inventory: exactly 22 rows of every type across 22 sites, covering FUEL
DISPENSER, ABOVE GROUND TANK, DECALS and SECURITY GUARD alike. No asset
has a dispenser as a parent. Serial numbers are empty at every level.
`astComponents` exists with a good structure and Prowalco does not
populate it (owner-confirmed).

So OnKey cannot answer "which dispensers are at this forecourt and what
are their serial numbers". Only our register can. Dispenser and
component identity is not a stopgap until OnKey catches up; it is
permanently ours, and the roadmap should say so.

### 2. The spares picker is mis-scoped and should be split

FR-SP-03 describes picking a warehouse, searching an item, entering a
quantity. The data says that is a minority case. Of 500 spares lines:

| Item | Meaning | Unit | Lines |
|---|---|---|---|
| TRA_TECH | Technician travel | km | 145 |
| LAB_TECH | Labour on site | hrs | 133 |
| VEH_TECH | Vehicle | km | 112 |
| actual parts | | EA | the rest |

This is a job-costing sheet. A parts-only picker leaves a technician
unable to record most of what the office bills on.

**Resequencing that follows:** the three costing lines need no stock
data at all, so they can ship with zero Syspro dependency. Parts
selection, which needs live quantities from Syspro, comes second. That
splits a Syspro-blocked feature into an unblocked majority and a
blocked minority, and should be done.

### 3. Certificate attachment should be the first write, ahead of status

Currently sequenced after status write-back. I would flip it.

`stdRecordFiles` shows **zero verification certificates** attached to
any work order: no filename contains cert, calib or verif across 1000
attachments. Certificates and the jobs that produced them are separate
records today. Attaching one is not automating an existing step, it is
creating a traceability link that has never existed. That is the
strongest single claim this project can make to an assessor.

On risk it also wins. Attaching a file is additive and cannot corrupt a
work order's state; a status change mutates live data. It is verifiable
by reading `stdRecordFiles` back, rather than trusting an import
response. And it does not depend on the user-account gap below.

**The one thing that makes this harder than it looks:** the
DocumentLinkImport contract has never been introspected (the WSDL does
not resolve from the sandbox). So the first task is contract discovery,
by trial and error against per-record `RecordFailures` if necessary,
which is already the agreed method for mandatory columns.

### 4. Status write-back is riskier than assessed, and blocked for six people

Two findings.

The transition register is **advisory, not enforced**. The most common
transition in the system, DOCARC to CLC with 647 occurrences, is not in
it. Our gate stays strict because every hop we need IS registered and
verified, but we cannot claim it reflects what OnKey will accept, and
we should verify writes by reading `wrkWorkOrderQueue` back rather than
trusting import responses.

And of 72 technicians holding work orders, **6 have no OnKey user
account**, holding 26 live work orders between them. `QueueUser` on a
status change is a user code. Those six cannot close jobs from the app
until accounts exist. That is administrative, not technical, and it
needs raising now rather than surfacing mid-pilot as "the app does not
work for X".

### 5. The Tasks tab is deleted

Every work order has exactly one task, in all 1006 sampled. We look it
up and book against it silently. The technician never meets the
concept. Remove FR-WO-02 from the plan.

### 6. Three systems, no foreign keys, and the mapping is ours

| Owns | System |
|---|---|
| Work orders, people, status, progress, job costing | OnKey |
| Stock quantity, bill of materials | Syspro |
| Dispenser identity, components, verification | us |

Every `ExternalReference` we probed is empty: on warehouses, stock
items, work orders and assets. **OnKey holds no foreign keys to
anything.** So every cross-system join is a mapping we build and
maintain, keyed on codes that match by convention rather than by
constraint. That is an ongoing obligation, not a one-off import, and it
deserves its own table and its own monitoring rather than being
scattered through queries.

Syspro's BOM is model-level. Connecting a physical dispenser to its
bill of materials runs through our register, on make, model and serial
that a technician captures. Nothing in OnKey provides that anchor.

### 7. Do not display an SLA number yet

`wrkWorkOrderQueue` carries a business-hours clock: elapsed minutes
alongside counts of week nights, weekend days and public holidays. We
cannot reproduce the office's figure without Prowalco's working-day
definition. Until we have it, the job screen shows honest wall clock,
labelled as such. A number that disagrees with the office is worse than
no number.

### 8. Render must go paid before Syspro, not after

The free instance already returned a 520 mid-probe and its outbound
address is not guaranteed stable across restarts. Prowalco's firewall
will allowlist that address. A rotated IP fails an allowlist silently.
This is now a dependency of the Syspro integration, not a nicety.

## Recommended order of work

1. **Render to paid**, re-measure egress, send Prowalco the final
   address. Unblocks Syspro and removes the 520s.
2. **DocumentLink contract discovery**, then certificate and job-card
   attachment, verified by reading `stdRecordFiles` back. First real
   write, highest value, lowest blast radius.
3. **Job costing lines** (travel, vehicle, labour hours). No Syspro
   dependency, delivers most of the spares value.
4. **Status write-back**, dry-run first, verified by queue read-back,
   and only for technicians with user accounts until the gap is closed.
5. **Syspro van stock**, then parts selection in the costing sheet.
6. Close-out feedback, once the classification registers are authored.

## Questions that block or reshape work

Not nice-to-haves; each one changes what gets built.

1. Does booking a spare in OnKey already decrement Syspro? Decides
   whether the spares write has one target or two.
2. Does the office bill labour from LAB_TECH spares lines or from
   `wrkTaskLabour`? Both are populated. Writing to the wrong one puts a
   technician's time where nobody looks.
3. How is overtime split across the three buckets? 10,700 minutes were
   booked in one month.
4. What is the working-day definition? Blocks any SLA display.
5. Six technicians need OnKey user accounts.
6. Is a work order carrying `ENGRSAPMVER` a verification job? If so the
   app should open the verification flow directly and the issued
   certificate completes that task.
7. What does the existing Boomi document-extraction process feed? Our
   attachments should join that filing convention, not create a rival.

## What I would cut

- **PWR-AST01 replacing the master uploads.** The asset register has no
  serial numbers and no dispensers. There is nothing to retire it with.
- **FIELDOPS - ASS LOC as a GPS source.** 5 of 2000 locations carry a
  position. Keep it for addresses and contacts only.
- **The Tasks tab**, per above.

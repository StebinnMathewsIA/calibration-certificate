# OnKey Analyser Report specification: the complete read surface

Prepared 2026-08-01 for the work-order management phase. OnKey reads are
Analyser Reports (SQL authored in the OnKey UI) served by the generic
export service, so this document is the full list of reports to author
for a production-ready integration, replacing reliance on WOE001 alone.
Report codes below are proposals; the author may rename them, the
`ReportCode` string is configuration on our side either way.

General rules for every report:
- Include a stable primary key column (the OnKey Id AND the Code where
  both exist). Ids are int64.
- Include an `IsActive`/deleted marker where the underlying table has one.
- Reports that can exceed the record cap must accept StartDate/EndDate
  parameters so our chunked fetcher (already built for WOE001) can split
  windows; reference-data reports that always fit need no parameters.
- Date columns in ISO format, as WOE001 already does.

## Priority 1: blocks current tickets

### PWR-WO01: Work order detail (successor to WOE001)
Purpose: the work list, lifecycle, close-out and test harness all read
from this. Unlike WOE001 it must return work orders in EVERY status, so
completed and costing-complete records (including the [TEST] set) are
visible; our side filters.
Parameters: StartDate, EndDate (on last-changed timestamp), optional
WorkOrderCode (exact), optional StatusCode.
Columns: WorkOrderId, WorkOrderCode, ParentWorkOrderCode,
ExternalReference, WorkRequired, WorkPerformed, StatusCode (the
UserDefinedStateCode value), StatusDescription, QueueCode/Description,
QueueUser, Priority, StaffCode, AssetCode, AssetDescription,
SiteNumber, SiteName, ImportanceCode + description + response/SLA
minutes if modelled, TypeOfWorkCode, TradeCode, GeneralLedgerCode,
CostCentreCode, ReceivedOn, StartOn, RequiredBy, CompleteBy,
CompletedOn, StatusChangedOn, IsPermitRequired, PermitNumber, EventCode,
work order GPS, asset GPS.
Unblocks: #94 (all FR-WL-02/FR-WO-01 fields), #95/#96 (status truth),
#102 (close-out read-back), the created-WO code resolution (query by
parameter after an Insert returns only RecordId), and test-WO
visibility. Cadence: 5-minute incremental + backfill, same pipeline as
WOE001. WOE001 retires once this is verified side by side.

### PWR-WT01: Work tasks per work order
Purpose: labour and spares imports key on WorkTaskId; the Tasks tab
(FR-WO-02) lists them.
Parameters: StartDate/EndDate (parent WO window) or WorkOrderCode.
Columns: WorkTaskId, WorkOrderCode, TaskCode, TaskDescription,
SequenceNumber, TaskAssetCode, TaskComponentCode, IsStandardTask,
EstimatedDurationInMinutes, task status if modelled.
Unblocks: #98 (labour), #99 (spares against tasks), Tasks tab.
Cadence: 5-minute, piggybacked on the WO window.

### PWR-REF01: User-defined states and queues
Purpose: the authoritative UserDefinedStateCode list plus queues, so the
status mapping (#96) is data, not guesswork, and transitions can be
validated before sending.
Parameters: none.
Columns: StateCode, StateDescription, state category/sequence (whether
it counts as open, in progress, complete, cancelled), IsActive;
QueueCode, QueueDescription, queue-to-branch/section mapping, and the
allowed-transition table if OnKey models one.
Unblocks: #96, #102. Cadence: daily (configuration data).

### PWR-REF02: Failure analysis and work classification registers
Purpose: FR-FB-03 requires failure analysis at asset or component level;
the feedback merge sends FailureCode, FailureTypeCode, RootCauseCode,
RepairTypeCode, and WO creation sends TypeOfWorkCode, ImportanceCode,
TradeCode. The pickers need the real values.
Parameters: none.
Columns (one report or one per register, author's choice): failure
codes + descriptions, failure types, root causes, repair types, types
of work, importance/SLA classes with response times, trades, sections,
cost centres, general ledger codes. Each with Code, Description,
IsActive.
Unblocks: #97, WO/work-request creation. Cadence: daily.

## Priority 2: unblocks the second wave

### PWR-INV01: Warehouses and warehouse items
Purpose: the stock-item spares flow (FR-SP-03: pick warehouse, search
item, quantity, unit).
Parameters: optional WarehouseCode; date window if item count exceeds
the cap.
Columns: WarehouseCode, WarehouseDescription, warehouse site/branch;
ItemCode, ItemDescription, UnitCode, ItemType, unit price, currency,
SupplierCode, IsActive, on-hand quantity if exposed.
Unblocks: #99 step 2. Cadence: daily.

### PWR-STF01: Staff members
Purpose: replaces the manually uploaded technician master as the source
of staff identity (codes, names, emails, sections/branches), feeding
the same enrichment pipeline; also validates StaffCode on labour lines.
Parameters: none.
Columns: StaffCode, first name, surname, email, section/branch,
TradeCode, CalendarCode, IsActive, manager/supervisor link if modelled.
Unblocks: identity mapping hardening, allocation upkeep from OnKey
truth. Cadence: daily. POPIA: lands in RLS-locked tables only, as the
master upload does today.

### PWR-AST01: Asset register
Purpose: today equipment is derived only from work orders, so an asset
with no recent WO is invisible; the full register gives every dispenser
per site including idle ones, plus identity fields.
Parameters: date window on changed-at, or site.
Columns: AssetId, AssetCode, AssetDescription, asset type code and
description, parent asset, site/location code, GPS, Barcode, IsActive,
commissioned/decommissioned dates if modelled.
Unblocks: complete site dispenser lists, relocation detection from
OnKey's own record, future asset condition reporting (BL-DOC-10).
Cadence: daily.

## Priority 3: after the DocumentLink contract is introspected

### PWR-DOC01: Document links per record
Purpose: read-back that certificate/job-card attachment landed (#101,
#102) and the Documents tab list (FR-AT-05).
Parameters: WorkOrderCode or record id + table id (semantics follow the
DocumentLinkImport introspection from the signing service's network).
Columns: link id, table/record reference, document code and
description, file name/path or URL as OnKey models it, created by/on.
Cadence: on demand or hourly.

### PWR-WO02: Work order status history (nice to have)
Purpose: verify our write-backs independently and feed SLA insights;
per-transition timestamps and acting user, if OnKey exposes the status
history table to the Analyser.
Parameters: StartDate/EndDate.
Columns: WorkOrderCode, from/to state, changed on, changed by, remark.
Cadence: 5-minute piggyback.

## Delivered reports (verified against the live sandbox)

Authored by Prowalco in the OnKey Analyser and proven end to end with
`POST /v1/onkey/probe-report`. Recorded here because the exact parameter
names and value formats are not guessable and cost several probes each.

### FIELDOPS - STAFF (PWR-STF01)
594 rows, 358 active, every one with an email address; 87 staff codes
match work-order staff codes across 71 sites. Columns: Code, Id,
Description, FirstName, LastName, Initials, Email, Mobile, JobTitle,
IsActive, SiteCode, SectionTradeTradeCode, SectionTradeTradeDescription,
LastModifiedOn.
Parameters: wildcard string filters, `%` for all.
Known gap: GeographicDataLocation (technician home base) is ticked in
the column list but does not appear in the export. Two re-probes
returned byte-identical payloads, confirmed by unchanged content hashes.
Parked: home base only sharpens morning route planning.

### FIELDOPS - INV (PWR-INV01)
Base table stkWarehouseItems, joined to Warehouses (and its Site),
StockItems (and its Unit and PreferredSupplier), the warehouse-item Unit,
and Categories. 25 columns, all populated.

The material finding: **every warehouse is a technician van**, named
`VAN - <branch> - <person>` (RSAJHB, RSADBN, RSACPT, RSACTN, LESOTHO,
BOTSWANA, SWA). 77 vans, 417 distinct part numbers, 5305+ warehouse-item
rows. The spares picker therefore opens on the technician's OWN van
stock rather than a company-wide item master, and WarehouseSiteCode
gives the branch grouping.

Parameters (names and value formats are exact, all three verified):

| Name | Operator | Value | Notes |
|---|---|---|---|
| `StockItemCode` | Is Like | `%` | `9%` returned 626 rows fleet-wide |
| `WarehouseCode` | Is Like | `%` | `EB` returned 124 rows in 19 s |
| `IsActive` | Is Like | `1` | boolean: **`1`, not `True`** (`True` faults with E5044) |

Ingest rule: **page by WarehouseCode.** MaxRecordCount caps rows
returned but NOT query cost, because the generated SQL joins
usrUserRights per site:

```sql
JOIN usrUserRights UR ON ((stkWarehouseItems.SiteId = UR.SiteId)
  AND (UR.UserId = @UserId) AND (UR.RightId = @RightId))
```

So one van takes about 20 seconds while the unfiltered pull runs past
280 seconds and trips client timeouts. Note the export still COMPLETES
server-side when the client gives up, so a timed-out probe can still
land its rows.

ANSWERED (2026-08-03, owner): **Syspro is the system of record for van
stock, not OnKey.** That explains the vans carrying items at zero
quantity across the board (EB 124 items, NC 61, BW 58, JC 56, all zero):
OnKey's QuantityOnHand is not maintained.

Consequences, and they are load bearing:
- **Never display OnKey's QuantityOnHand.** A wrong number is worse than
  no number, because a technician who trusts it drives to a job without
  the part. OnKey gives the picker item IDENTITY (which items belong to
  which van, their description, unit, bin, cost, minimum quantity);
  Syspro gives the QUANTITY.
- The van register itself stays OnKey's: warehouse codes are what
  `wrkTaskSpares.WarehouseItemId` points at, so the write path needs
  them regardless.
- The join key between the two systems is unproven. Candidates are
  warehouse code plus stock code matching directly, or OnKey's
  ExternalReference fields carrying the Syspro keys (WarehouseExternal
  Reference came back empty on every row; StockItem ExternalReference
  has not been selected yet and is worth probing).

See docs/SYSPRO-INTEGRATION.md for the connection design.

### FIELDOPS - STATE (PWR-REF01, part 1)
Base table `wrkWorkOrderStatuses`. 53 statuses with Code, Description,
BaseStatus, BaseStatusDescription, Id, IsActive. The base status is the
prize: it classifies every code as Approved (28), Completed (12),
Awaiting Approval (9), Closed (3) or Cancelled (1).
Wired in migration 031 as `onkey_statuses`; `app_open_statuses()` now
derives from it. Corrected two real errors: Referral (REF) is a
Completed status we were showing as open, and WPA/WST/WOS/SCTD/DIS/TUA
are approved work we were hiding. 39 more work orders reached the
lifecycle on re-seed.

### FIELDOPS - STATEMAP (PWR-REF01, part 2)
Base table `wrkWorkOrderTargetStatuses`, with the status relationship
expanded on BOTH sides (ParentCode/ParentDescription and
WorkOrderStatusCode/WorkOrderStatusDescription) plus BaseStatus and
ApplyTargetStatusRules on each. 115 transitions, rules enforced
throughout.

The technician path it describes is our state machine exactly:

```
ALC -> WOR -> WPA <-> WRE -> WST -> WOS -> CPD
               |
               +-> LSI (Incomplete for Spares) / REF (Referral)
```

LSI and REF are reachable only from WPA and neither returns to WRE, so
the blocks_resume rule in migration 027 is OnKey's rule too. Wired in
migration 032 with `onkey_transition_plan()`, which walks every hop and
refuses anything it cannot verify.

Note: `wrkWorkOrderTargetStatuses` has no SiteId of its own, so the Site
Path must be set through the status relationship (the green globe icon
on the SiteId node), otherwise the Analyser cannot build the user-rights
join.

### FIELDOPS - IMP (PWR-REF02, partial)
Base table `wrkImportances`. 5 rows: SLA-Emergency 10, SLA-Urgent 7,
Other/Manual 5, SLA-Normal 3, UNKNOWN 0, where Weight is OnKey's own
urgency ranking. Replaces the HIGH/CRITICAL/MEDIUM/LOW labels the
scheduler was using, which do not exist in OnKey.
Wired in migration 033, but INERT until FIELDOPS - WOE carries
ImportanceCode: all seeded work orders have importance_code NULL today.

### FIELDOPS - QUEUE (PWR-WO02)
Base table `wrkWorkOrderQueue`, which is NOT a queue lookup: it is one
row per status change. 37 columns including old and new status, old and
new queue user, who changed each and when, Remark, Priority,
PredecessorId chaining the history, IsLatest marking the current row,
and its own ExternalReference (currently empty everywhere, and the
natural home for our write idempotency key).

All ten Elapsed fields are the business-hours SLA clock. Units are
MINUTES for elapsed time and COUNTS for nights, weekend days and
holidays, so the office's figure is the raw minutes with those deducted.
We cannot reproduce it yet: deducting needs Prowalco's working-day
definition (what hours a working day spans, which days count). Ask for
the business calendar before showing any SLA number, and until then show
honest wall clock rather than a figure that disagrees with the office.

The elapsed data also proved DOCARC -> CLC is automated: 298 occurrences
averaging 12.7 minutes, never once spanning a night. That is why it is
the most common transition in the system and absent from the target
register (see migration 036), and it is a machine rather than a person.

### Syspro join key: NOT available from OnKey
FIELDOPS - INV was amended to select ExternalReference on StockItems, to
test whether OnKey carries Syspro's stock codes. It did not come back,
and WarehouseExternalReference behaves identically despite definitely
being selected. An export cannot distinguish "not selected" from "null
on every row", but two ExternalReference fields both absent is a pattern.

So OnKey does not hold Syspro's keys, and the join must be warehouse
code plus stock item code matching directly between the systems. That is
unverified. Ask Prowalco's IT for a twenty-row sample of InvWarehouse as
a CSV, separately from the live connection, so the codes can be checked
while the firewall work is still in progress rather than after it.

### FIELDOPS - TASK and FIELDOPS - LABOUR
Base tables `wrkTasks` and `wrkTaskLabour`. Neither has a SiteId, so the
Site Path runs through the parent: labour's is
`wrkTaskLabour_ParentId.wrkTasks_ParentId.wrkWorkOrders_SiteId`.

**Every work order has exactly one task.** Not one on average: one in
all 1006 work orders sampled. So the Tasks tab in the phase plan is not
needed. We look up the single task for a work order and book labour and
spares against it silently; the technician never meets the concept.

**`ENGRSAPMVER` is our own job, already modelled in OnKey**: "15 monthly
calibration of all pumps and provide calibration certificate, as per
scope of work." Alongside it are ENGRSAPM (pump PM plus checklist) and
ENGRSAPMLD (leak detector PM). 489 of 500 tasks are DEFAULT, so reactive
work carries a placeholder and contracted preventative work carries a
real task code.

That means OnKey already knows which work orders are verification work.
A job carrying ENGRSAPMVER should open on the verification flow rather
than making the technician find it, and the issued certificate is what
completes that task.

Labour columns: Id, ParentId (the WorkTaskId), ParentParentCode (the
work order), StaffCode, TradeCode, NormalTimeInMinutes, Overtime1/2/3
InMinutes, PerformedOn, RequiredOn, SequenceNumber,
LabourCostInSiteCurrency. 10,700 minutes of overtime were booked in one
month, so how Prowalco decides what counts as overtime is worth asking
before we write to those buckets.

Gotcha, and it cost two probes: filtering on `LastModifiedOn` returned
zero rows with no error. Prefer `Id >= @MinId` on these child tables,
which also gives keyset paging.

### FIELDOPS - SPARES
Base table `wrkTaskSpares`, Site Path
`wrkTaskSpares_ParentId.wrkTasks_ParentId.wrkWorkOrders_SiteId`.
500 rows across 132 work orders, and every single row carries a
WarehouseItemId, so the join back to van stock is complete with no gaps.

**Most spares lines are not spares.** Prowalco books travel, vehicle and
labour through this surface as warehouse items:

| Item | Description | Unit | Lines | Total |
|---|---|---|---|---|
| TRA_TECH | Technician Travel Time | km | 145 | 10,281 |
| LAB_TECH | LABOUR - ON SITE | hrs | 133 | 796 |
| VEH_TECH | Prowalco Technician Vehicle | km | 112 | 7,535 |
| EK-650-GREEN | Splash guard green | EA | 5 | 11 |

Physical parts are a minority. This is a job-costing sheet, not a parts
list, so a parts-only picker would leave a technician unable to record
most of what the office costs the job on. Those three codes need to be
prompted rather than searched for, since they appear on nearly every job.

**QuantityRequired is the live field.** QuantityOrdered,
NettQuantityReceived, NettQuantityUsed, QuantityAvailableToUse and
QuantityStillToOrder are ALL zero across all 500 rows. Same pattern as
QuantityOnHand in FIELDOPS - INV, and consistent with Syspro holding
real stock movement.

**Open question, and it decides where we write.** Labour appears twice:
LAB_TECH spares lines totalling 796 hours, and
wrkTaskLabour.NormalTimeInMinutes, both populated. Ask which the office
bills from. Writing to the wrong one puts a technician's time where
nobody looks; writing to both risks double counting.

Worth raising later: 10,281 km of technician travel is typed in by hand,
and the app already captures GPS on every lifecycle transition.

### FIELDOPS - ASSET
Base table `astAssets`. **OnKey's asset register is not an equipment
inventory.** It is a per-site maintenance checklist: exactly 22 of every
asset type across 22 sites, covering FUEL DISPENSER, ABOVE GROUND TANK,
CANOPY STRUCTURE, DECALS and SECURITY GUARD alike. A site has one FUEL
DISPENSER row because dispensers are a thing maintained there, not
because it has one dispenser.

Zero assets have a fuel dispenser as parent, so there is no component
structure hiding in the hierarchy either. SerialNumber,
ExternalReference, CommissionedOn, SupplierCode and Notes were all
selected and all came back empty.

Three consequences. Our dispenser register is necessary rather than
duplication, because OnKey cannot say that a forecourt has four Tatsuno
dispensers with given serial numbers. There is no serial data at any
level. And the Syspro bill of materials has no join anchor on the OnKey
side: linking a physical dispenser to its BOM must run through our own
register, keyed on the make, model and serial a technician captures.

### FIELDOPS - USERS
Base table `usrUsers` with `StaffMemberId -> StaffMembers` expanded.
600 users, every one linked to a staff member with an email, which is
the mapping needed for `QueueUser` on a status write.

**Administrative gap, not a code problem.** Of 72 technicians holding
work orders, 66 resolve to an OnKey user and 6 do not; those 6 hold 26
live work orders between them. One of the 66 has an inactive account.
Without a user code there is nothing to send as QueueUser, so those
technicians cannot close jobs from the app until accounts exist. Would
otherwise surface mid-pilot as "the app does not work for X".

### FIELDOPS - DOC
SQL mode. `stdRecordFiles` is the attachment table and it is
polymorphic: `TableId` + `RecordId`, where **TableId 1196 =
wrkWorkOrders**. `stdRecordFileContent` holds the bytes keyed by
ParentId, and is deliberately NOT joined: we want metadata, not blobs.

1000 attachments: 928 PDFs averaging 339 KB, 71 JPGs averaging 3.4 MB.
Naming is conventional, not free-form: `RN_Work completion sign off_<n>
.pdf` accounts for 843 of them, alongside RN_SHL_WCF, RN_PTW_ALL (permit
to work) and RN_SHL_JHA (job hazard analysis).

Two findings. Our client-signed job card already has a home: it IS the
work completion sign off, so it should follow that naming and land where
the office already looks. And **there are zero verification certificates
in the entire sample**: no filename contains cert, calib or verif. So
certificates are not attached to work orders today at all. Attaching one
is not automating an existing step, it is creating a link that has never
existed, which makes it a compliance gain rather than an efficiency one.

Prowalco also runs a Boomi document-extraction process over this table
using the work order code as a subfolder name. Worth asking what it
feeds before we add a parallel filing convention.

### FIELDOPS - ASS LOC
Base table `astLocations`, parameters `Code` (Is Like) and `MinId`
(Is Greater Than).

First probe returned only Code, Description, GeographicDataLocation,
IsActive and LastModifiedOn, which looked like a dead end. It was not:
the table also carries **Address1, Address2, Address3, Contact, Email,
ExternalReference, Notes and a ParentId hierarchy**, they simply had not
been selected. Those are precisely the fields our site record holds and
often has blank, and the reason the manual site-edit feature (#60)
exists.

What IS genuinely empty is GPS: 5 of 2000 locations carry a position,
against our own register's 2532 sites with only 12 missing. So this
report is for addresses and contacts, not coordinates.

Lesson worth keeping: an export that returns few columns means little
until the selected-column list has been checked. Omitted and empty look
identical from here.

### Authoring recipe for the remaining reports
- Header tab: Code, Description, Site PRD, Active, User Right, and
  **Is For Export** ticked (the export service cannot see it otherwise).
- Filter Criteria rows become parameters through the row's own **Name**
  and **State: User Defined** fields. The Name is the exact string
  passed to ExportData and it is case sensitive. A row with no Name is
  compiled in as a literal.
- Use **Is Like**, never Is Equal To: Is Equal To matches a literal `%`
  and returns zero rows.
- Never select the same column name twice. `parse_export_xml` builds
  each row as a name-to-value map, so a duplicate silently overwrites
  with no error.
- Stay in the Query builder rather than the SQL Statement tab. In
  builder mode `select top N` tracks MaxRecordCount; in SQL mode it is
  frozen text and becomes a silent ceiling.
- Columns that are null in every returned row are omitted from the
  export entirely, so an absent column means unpopulated data, not a
  missing selection.

## What this replaces and what stays

WOE001 stays in production until PWR-WO01 runs side by side and the
registers derive identically (the same content-hash snapshot pipeline
ingests both, so parallel running is cheap). The technician and location
master uploads stay until PWR-STF01/PWR-AST01 prove more complete than
the files. Every report lands in its own raw snapshot table with
content-hash dedupe, and derivation into the app-facing registers stays
in SQL, per the architecture.

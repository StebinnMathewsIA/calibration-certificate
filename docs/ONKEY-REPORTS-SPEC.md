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

## What this replaces and what stays

WOE001 stays in production until PWR-WO01 runs side by side and the
registers derive identically (the same content-hash snapshot pipeline
ingests both, so parallel running is cheap). The technician and location
master uploads stay until PWR-STF01/PWR-AST01 prove more complete than
the files. Every report lands in its own raw snapshot table with
content-hash dedupe, and derivation into the app-facing registers stays
in SQL, per the architecture.

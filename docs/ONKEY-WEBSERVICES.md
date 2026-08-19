# OnKey Web Services: working notes for the work-order management phase

Distilled 2026-08-01 from the owner-supplied "On Key 5 Web Service API
Guide" (Pragma Products, rev 2018-04-17, covers releases up to 5.16 SP2).
The vendor PDF itself stays out of the repo; this document carries
everything needed to build against the API. Our backend already implements
the EXPORT half (backend/app/workorders/onkey_sync.py, zeep); the next
phase adds work-order management, which means the IMPORT half.

## 1. Protocol fundamentals

- SOAP 1.1 + WSDL 1.1, WS-I Basic Profile 1.1, over TLS. Interoperable
  with zeep (which we use), .NET, Java.
- WSDL per service at `{vdir}/Services/Interfaces/{Service}.svc?singleWsdl`
  where `{vdir}` is the IIS virtual directory (e.g.
  `https://host/OnKey5`). The full service list is browsable at
  `{vdir}/Services/Interfaces/`.
- Versioning policy: Pragma supports ONLY the latest API version, aims for
  backward compatibility, and signals breaking changes as a new contract
  version in release notes. Namespace root:
  `http://schemas.pragmaproducts.com/onkey` (contracts:
  `http://contracts.pragmaproducts.com/onkey/System/v1`).

## 2. Authentication and sessions

- `Authentication.svc` `Logon(LogonDetails{UserName, Password,
  ConnectionName})` returns a `SessionId`. ConnectionName selects the
  OnKey database/tenant.
- Every subsequent call carries the SessionId as a SOAP HEADER (zeep:
  `_soapheaders={"SessionId": ...}`). Authorisation follows the OnKey
  user's rights, so the integration account needs rights for every
  operation we call.
- Sessions expire after inactivity (default 30 minutes, server
  configurable). Expiry surfaces as a SOAP fault with ErrorCode
  `SessionExpired`: re-Logon and retry.
- `TooManyConcurrentSessions` is a real fault: always `LogOff` when done
  (our sync uses a context manager) and keep ONE session per process, not
  one per request.

## 3. Call styles

- Synchronous request/response for short operations.
- Asynchronous request/acknowledge/poll for long ones: the request returns
  an `AsyncRequestId` (int64); poll `FetchAsyncImportProgress`, fetch
  `FetchAsyncImportResults`, or `CancelAsyncImport`. Import services
  support both styles. Prefer synchronous for our batch sizes; the async
  pattern exists if a bulk write-back ever grows.

## 4. Errors

Two channels, both of which must be handled:

1. SOAP faults (`FaultException<OnKeyServiceFault>` with
   `ErrorCode`/`ErrorMessage`) for server-side exceptions. Known codes:
   `SessionExpired`, `RecordNotFound`, `TooManyConcurrentSessions`,
   `DatabaseConcurrencyConflict`, `LogonPasswordExpired`, `NotAuthorized`.
2. Business errors inside an otherwise successful response: a top-level
   `Errors` collection, and for imports a per-record `RecordFailures`
   collection. A 200 response is NOT success until both are checked.

## 5. Exports (what we already do)

One generic `Export.svc` `ExportData` serves every read. The query itself
is an Analyser Report authored INSIDE OnKey (SQL written in the OnKey UI,
identified by `ReportCode`); the request carries `ReportCode`,
`DataSetName`, `MaxRecordCount` and named `Parameters`. The response
`DataSet` has `Data` (rows as CDATA XML named by DataSetName) and
`Schema` (column names/types), so results are self-describing.

Our production use (corrected 2026-08-20, the original WOE001 shorthand
here caused real confusion): the work-order lane polls the 65-column
`FIELDOPS - WOE` report (WOE001 was the narrow early-phase report from
issue 47, long retired; the live ReportCode comes from Render env via
`settings.onkey_report_code`). The registers ride the other FieldOps
reports: `FIELDOPS - USERS`, `- STAFF`, `- INV`, `- IMP`, `- REASON`,
`- QUEUE`, `- STATEMAP`, `- PROGRESS`, `- DOC`. Cadence is every 10
minutes since migration 117. FIELDOPS - WOE outputs
`WorkOrderLastModifiedOn` and its where-clause filters on
coalesce(queue-transition time, last-modified time), which is the
high-water-mark expression the delta design of issue 180 reuses.
Any new read the
work-order phase needs (e.g. richer WO detail, status history) is "author
a new Analyser Report in OnKey, call it with ExportData", NOT a new
service. That authoring happens in Prowalco's OnKey instance, so new
reads have owner lead time.

## 6. Imports (what the work-order phase will use)

Each business object has its own Import service. Imports SIMULATE the UI
action, so every OnKey business rule runs and violations come back as
`RecordFailures` per record. Set `IncludeRecordSuccesses` to true to get
the OnKey `RecordId` (int64) for every inserted/merged/deleted record:
store these against our records for traceability. Mandatory columns per
import are documented in the Interface Tool's Import Template files
(request from Prowalco).

Services most relevant to work-order management and certificate
write-back, with capabilities confirmed in the guide's change log:

- `WorkOrderImportService`
  - `ImportWorkOrderChangeStatusAndQueue` (WorkOrderId int64): move a WO
    through statuses/queues, i.e. close-out after a verification.
  - Work Tasks import (5.7+), Work Order Downtimes (5.8 SP1+), Work Task
    Labour with merge/insert incl. FinancialYearCode/Period and
    StaffToSiteConversionRate (5.12+), Work Order Costing (Description is
    part of the unique key from 5.16 SP2), Work Task Spares.
  - Work Orders accept geographic data (5.10+) and an
    OriginatorContactCode (5.12+).
- `DocumentLinkImportService`: `ImportDocumentLink(RecordId, TableId,
  ...)` links documents to records. This is the candidate mechanism for
  attaching issued certificate PDFs to the WO or asset; whether binary
  upload is supported or only links to a document store needs
  confirmation against the WSDL and the Interface Tool manual.
- `WorkRequestImportService`: create work requests (with user-defined
  fields, GPS, OriginatorContactCode) if the flow ever raises follow-up
  work from a rejection.
- `AssetImportService` / `AssetTaskImportService`: asset updates (GPS,
  barcode 5.13 SP1+, spares 5.16 SP2+) if we ever push component-register
  corrections back.
- `StaffMemberImportService`, `UserImportService` (StaffMemberCode column
  links users to staff members): relevant to the identity mapping.

## 6b. Discovered contracts (live WSDL introspection, 2026-08-01)

Introspected directly from the tenant's service registry (the base URL
lives in Render env, not this repo; note for the owner: the registry and
WSDLs are reachable WITHOUT authentication, data access still requires
Logon). Facts that remove the guesswork:

- **Type hierarchy**: `ImportItemBase{ReferenceId}` >
  `CrudImportItemBase{Action, Id}` > `MasterImportItem{Code, NewCode}` >
  business fields. `Action` is the enum Insert | Update | Delete | Merge.
  Master records are keyed by their **Code**, no internal Id needed.
- **WorkOrderImport.svc operations** (each with an Async twin):
  ImportWorkOrders, ImportWorkOrderChangeStatusAndQueues, ImportTasks,
  ImportWorkTaskLabour, ImportWorkTaskSpares, ImportWorkTaskSparesUsed,
  ImportWorkOrderCosting, ImportDowntimes.
- **ImportWorkOrderChangeStatusAndQueue** (extends ImportItemBase):
  `WorkOrderCode` (string) or `WorkOrderId` (long), plus
  `UserDefinedStateCode` (the target status; values come from the
  owner's status-flow document), `QueueUser`, `Priority`, `Remark`.
  Status write-back (#96) is therefore keyed by the codes we already
  sync.
- **ImportWorkOrder** (MasterImportItem, Merge on Code) carries the
  feedback surface directly: `WorkPerformed`, `Notes`, `StartOn`,
  `CompletedOn`, `ReceivedOn`, `RequiredBy`, `StaffCode`, the failure
  analysis block (`FailureCode`, `FailureTypeCode`, `RootCauseCode`,
  `FailedComponentCode`, `AnalysisComponentCode`, `RepairTypeCode`),
  `ExternalReference` (candidate slot for our certificate number),
  GPS fields, `IsPermitRequired`/`PermitNumber`. Feedback (#97) is one
  Merge on the WO code.
- **ImportWorkTaskLabourItem** (ChildImportItem): `StaffCode`,
  `NormalTimeInMinutes`, `Overtime1/2/3InMinutes`, `PerformedOn`,
  `Notes`, `TradeCode`, `WorkTaskId` (long). Labour (#98) needs the WORK
  TASK id, so the read side must surface task ids (extend WOE001 or a
  small export).
- **ImportWorkTaskSpare** (ChildImportItem): `WorkOrderCode`,
  `TaskCode`/`TaskId`, `ItemCode`, `ItemDescription`, `ItemType` (int,
  the four categories), `QuantityRequired`, `UnitCode`,
  `WarehouseItemWarehouseCode`, `SupplierCode`,
  `UnitPriceInSourceCurrency`. Spares (#99) map fully;
  ImportWorkTaskSpareUsed records actual usage (Quantity, Date,
  ItemCost) as a child of the spare line.
- Response shapes confirmed: `RecordFailures[{ReferenceId, Message}]`
  and `RecordSuccesses` with Ids; `AsyncImportStatus` enum for the async
  pattern.
- **DocumentLinkImport.svc**: listed in the registry, and its WSDL
  cannot be fetched. RESOLVED as a server defect, not a network one
  (2026-08-04): retried from Supabase's network, a completely different
  path, and it fails identically with an HTTP/2 stream reset ("stream no
  longer needed") on BOTH `?singleWsdl` and `?wsdl`, while
  Authentication.svc on the same connection returns 15 KB cleanly. So
  "introspect it from the signing service" was never going to work and
  should not be attempted again.

  What we know without the WSDL: the API guide gives
  `ImportDocumentLink(RecordId, TableId, ...)`, and FIELDOPS - DOC has
  since confirmed the polymorphic key from the live data, where
  **TableId 1196 = wrkWorkOrders**. The remaining unknown is whether the
  service accepts binary content or only a link to a document store.
  That is answerable by trial and error against per-record
  RecordFailures, which is already the agreed method for mandatory
  columns, and it needs no WSDL.
- The seven [TEST] work orders are NOT in our mirror: WOE001 only pulls
  open statuses and they sit at Completed / Costing Complete. Testing
  the visible lifecycle needs one flipped to an open status, or a
  temporary read extension.

## 7. Integration rules for our stack

- Client: extend the existing zeep client in
  `backend/app/workorders/onkey_sync.py` (bindings named
  `{contracts-ns}{Service}_HttpsSoap11BasicBinding`); one session per
  run, LogOff in a finally, re-Logon on `SessionExpired`.
- All OnKey access stays backend-to-backend (CLAUDE.md rule): the app
  never holds OnKey credentials; write-backs ride the existing outbox +
  sync machinery so they queue offline like everything else.
- Idempotency: OnKey imports are merge-style but NOT idempotent in the
  general case (DatabaseConcurrencyConflict exists); our write-back queue
  must record OnKey RecordIds and treat "already applied" re-runs as
  success, mirroring the sign-queue philosophy.
- Open questions for Prowalco before the phase starts: integration user
  account + rights + ConnectionName for a WRITE-capable user; which WO
  status/queue transitions represent "verified / certificate issued";
  Import Template files from the Interface Tool for WorkOrder and
  DocumentLink imports; whether their OnKey version matches this guide
  (5.16-era) or is newer, and the server's session timeout.

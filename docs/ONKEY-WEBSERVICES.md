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

Our production use: report `WOE001` polled every 5 minutes by the sync
service, parsed into the `onkey_*` register tables. Any new read the
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

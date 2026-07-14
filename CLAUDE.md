# Prowalco Calibration App — Project Brief (CLAUDE.md)

## What this project is

A mobile app (iOS + Android) for **Prowalco** (Tatsuno fuel dispenser/pump distributor, South Africa) that lets a field technician:

1. Sign in with a corporate/consumer identity provider (Microsoft, Google, or Apple)
2. Complete a structured pump/dispenser calibration form on-site
3. Generate a **digitally signed, tamper-evident PDF calibration certificate** on-device
4. Send the calibration results to the **Claude API** for automated analysis ("is this a good calibration?") visible to the technician and their manager

Target compliance context: **ISO/IEC 17025**-style traceability and SANAS-aligned certificate content (modelled on a SANAS-accredited lab certificate). Legal metrology context for fuel dispensers in SA: NRCS / OIML R117 tolerances — confirm exact applicable tolerances with Prowalco's quality manager before hard-coding pass/fail limits.

---

## Repository layout

```
/
├── CLAUDE.md              This brief
├── shared/schema/         Shared zod schemas (TypeScript) — single source of truth for the
│                          calibration form, sign-queue envelope, and Claude verdict shapes.
│                          Exports JSON Schema for the Python backend (validation parity).
├── mobile/                Expo (React Native) app — form, offline sign queue, PDF render
├── backend/               FastAPI service — auth verification, schema re-validation,
│                          PAdES signing (pyHanko + KMS abstraction + RFC 3161 TSA),
│                          append-only audit log, Claude analysis proxy
└── docs/                  E-signature procedure, key rotation runbook (assessor-facing)
```

---

## Architecture overview

- **Mobile app**: **React Native with Expo + EAS** (decided — client has an EAS account). Use an **EAS development build / dev client**, not Expo Go, because native modules (crypto, Google Sign-In) are required.
- **Backend API** (Node or Python) with:
  - OAuth/OIDC federation (Microsoft Entra ID, Google, Apple Sign-In) — use a broker like Auth0/Firebase Auth/AWS Cognito rather than hand-rolling
  - **Signing service**: private keys held in cloud KMS/HSM (AWS KMS, Azure Key Vault). Keys are NEVER on the device.
  - **Immutable audit log** (append-only table / write-once storage)
  - **Claude API integration** for calibration analysis
- **Signing flow (final — single flow, no on-device key material):**
  1. App renders the certificate PDF locally (`expo-print` HTML template)
  2. Technician taps **Sign** → biometric/PIN re-prompt → app records intent-to-sign (device timestamp, GPS)
  3. App queues the package locally: form JSON + PDF bytes + local SHA-256 + client-generated **idempotency UUID**
  4. When online: upload package + auth token to backend
  5. Backend verifies the session, **re-validates the form JSON against the shared zod schema**, and cross-checks key fields (certificate number, technician, result values) against the PDF text layer — a compromised client cannot get arbitrary content signed
  6. Backend applies a **PAdES-compliant** signature (visible widget: technician name + signing date) with keys in **KMS/HSM** + **RFC 3161 trusted timestamp**, writes the audit event, returns the signed PDF
  7. App verifies the returned PDF (hash + signature present), stores it, marks the certificate **issued**
- **Timestamp semantics (assessor-relevant):** if signing was queued offline, the audit trail records BOTH the technician's intent-to-sign time (device clock) and the cryptographic signing time (TSA). The visible signature date on the PDF is the TSA date. The certificate is only "issued" once signed — never distribute unsigned output.
- **Offline & sign-queue state machine:** technicians work at forecourts with poor connectivity, so every state below is **persisted to expo-sqlite and survives app kill/restart**:
  - `DRAFT` → form in progress, autosaved on every field change
  - `READY_TO_SIGN` → validation passed, declaration ticked
  - `QUEUED_FOR_SIGNING` → biometric done, package (form JSON + PDF + SHA-256 + idempotency UUID) written to the durable queue
  - `UPLOADING` → in flight; on failure return to `QUEUED_FOR_SIGNING`
  - `SIGNED` → signed PDF received, verified, stored locally
  - `SYNCED` → audit record confirmed server-side
  - Retry rules: connectivity listener (`@react-native-community/netinfo`) + retry with exponential backoff on app foreground and launch; best-effort background fetch. The **idempotency UUID guarantees retries never double-sign or double-issue** a certificate. Verify the queued PDF's SHA-256 before every upload attempt to detect local corruption. Partial uploads are safe to repeat.

## Audit trail (per certificate)

Store: certificate number, technician identity (IdP subject + name), auth method, device ID, timestamps (start, sign), GPS location (with consent), SHA-256 of signed PDF, signature ID, Claude analysis verdict + model + prompt version, any amendments (amendments create a NEW certificate number superseding the old; never mutate a signed record).

---

## Branding

- Prowalco logo (green/blue "prowalco" + red "TATSUNO") top-left of certificate; asset provided by client (`assets/prowalco-logo.png`)
- Accreditation marks (SANAS etc.) top-right IF/WHEN Prowalco holds accreditation — placeholder slot in template, feature-flagged off by default
- Certificate visual layout modelled on standard SANAS calibration certificates: header block, "CERTIFICATE OF CALIBRATION", certificate number, detail rows, results tables, signature block, footer with contact details and "Page X of Y"

---

## Calibration form specification

Certificate number format: auto-generated, e.g. `PWC-{branch}-{sequence}-{revision}` (confirm scheme with Prowalco).

### Section 1 — Job & customer details
| Field | Input type | Notes |
|---|---|---|
| Certificate number | Auto-generated, read-only | Unique, immutable |
| Work order / job number | Text (PoC) → work-order picker (future) | Free text in PoC; becomes the On Key WO link in future state |
| Customer / site name | Text or picker from CRM list | Required |
| Site address | Address fields or picker | Required |
| Site/asset number | Text | e.g. forecourt ID |
| Calibration date | Date picker (default today) | Required |
| Issue date | Auto (date of signing) | Read-only |

### Section 2 — Unit under test (UUT)
| Field | Input type | Notes |
|---|---|---|
| Equipment type | Dropdown: Fuel dispenser / Pump / Flow meter / Pressure transmitter / Other | Required |
| Manufacturer | Dropdown (Tatsuno default) + free text | Required |
| Model number | Text | Required |
| Serial number | Text + barcode/QR scan button | Required |
| Pump/hose/nozzle ID | Text | Per-nozzle calibration |
| Product/grade | Dropdown: ULP 93 / ULP 95 / Diesel 50ppm / Diesel 500ppm / Paraffin / Other | Fuel-specific |
| Meter K-factor before | Numeric | If applicable |

### Section 3 — Reference standards used
Repeating group (add one row per standard):
| Field | Input type | Notes |
|---|---|---|
| Standard description | Dropdown from equipment register (e.g. 20 L proving measure) | Required |
| Serial number | Auto-filled from register | Read-only |
| Certificate number | Auto-filled | Read-only |
| Calibration due date | Auto-filled | **Block signing if expired** |

### Section 4 — Environment & method
| Field | Input type | Notes |
|---|---|---|
| Ambient temperature (°C) | Numeric, 1 decimal | Required |
| Product temperature (°C) | Numeric, 1 decimal | Affects volume correction |
| Procedure/method reference | Dropdown of controlled procedures | Required |
| Condition of UUT | Dropdown: Good / Damaged / Leaks noted / Other + notes | Required |

### Section 5 — Results ("As found" and "As left")
Two identical tables; "As left" only shown if adjustment made (toggle: **Adjustment performed? Yes/No**).

Repeating rows per test point (typical: low flow, high flow, multiple deliveries):
| Field | Input type | Notes |
|---|---|---|
| Nominal delivery (L) | Numeric (e.g. 20.00) | Required |
| Flow rate (L/min) | Numeric | Low/high flow tests |
| Indicated volume (L) | Numeric, 2–3 decimals | From dispenser display |
| Measured volume (L) | Numeric, 2–3 decimals | From proving measure, temp-corrected |
| Error (mL) | Auto-calculated | (Indicated − Measured) × 1000 |
| Error (%) | Auto-calculated | Highlighted red if outside tolerance |
| Tolerance applied | Auto from config (e.g. OIML R117 / NRCS class) | Confirm limits with client |
| Pass/Fail | Auto-calculated badge | |

Additional:
| Field | Input type |
|---|---|
| Meter K-factor after | Numeric |
| Uncertainty of measurement | Auto from lab uncertainty budget config (state k=2, ~95% confidence) |
| Remarks / notes | Multiline text |
| Photos | Camera capture (seal, totaliser, display) — embedded in cert appendix or stored in audit trail |
| Verification seal number(s) | Text + photo |

### Section 6 — Sign-off
| Field | Input type | Notes |
|---|---|---|
| Calibrated by | Auto = logged-in technician | Read-only |
| Technical signatory / reviewer | Picker (authorized signatories only) | Two-role model like SANAS certs; may be same person if policy allows |
| Declaration checkbox | "I certify these results are true and the procedure was followed" | Required before signing |
| Sign action | Button → biometric/PIN re-prompt → triggers signing flow | |

Validation rules: all required fields complete, standards in-date, at least one result row, declaration ticked — otherwise sign button disabled with reasons listed.

---

## Certificate PDF content (in order)

1. Header: Prowalco logo, company reg number, (accreditation mark slot)
2. Title + certificate number
3. UUT details, customer details, dates, signatory names with **visible digital signature widgets**
4. Standards & equipment table
5. Procedure, traceability statement, environment, uncertainty statement (k=2, ~95%)
6. Results tables (as found / as left), remarks
7. Standard clauses: reproduction-in-full-only clause, validity-at-time-of-calibration clause
8. Footer: contact details, page numbering, "END OF CERTIFICATE" marker
9. Embedded PAdES signature(s) + RFC 3161 timestamp; document locked after final signature

## Claude analysis feature

- After results entry (before or after signing — recommend BEFORE signing so technician can react), backend sends structured JSON of the calibration to the Claude API and requests a structured verdict.
- Suggested output schema: `{ "verdict": "pass|marginal|fail|data_anomaly", "summary": "...", "concerns": [...], "recommendations": [...] }`
- Prompt should include: tolerances in force, as-found vs as-left data, environment, standards used, and instruct Claude to flag: out-of-tolerance points, drift patterns, suspicious data (identical readings, impossible values), expired standards, temperature-correction issues.
- Show verdict in-app to technician; notify manager (push/email) on `marginal`, `fail`, or `data_anomaly`.
- **The Claude verdict is advisory and is logged, but the human signatory remains responsible** — record this in the quality procedure.
- Implementation: Anthropic Messages API from the backend (never embed API keys in the mobile app). See https://docs.claude.com/en/api/overview for current models, structured output options, and SDKs.

## Non-functional requirements

- POPIA (SA privacy law) compliance for customer + technician data; GPS capture requires consent
- Certificate retention per lab policy (typically ≥ 5 years); signed PDFs in write-once storage
- Key rotation policy in KMS; certificate chain from an internal CA is acceptable for v1 (validate with accreditation assessor), upgrade path to a public/qualified CA later
- Document the e-signature procedure for the SANAS/accreditation assessor — this is audited as much as the tech

## Tech stack (decided)

### Mobile (Expo + EAS, dev-client workflow)
- **Framework:** Expo SDK (latest), TypeScript, Expo Router
- **Auth:** broker all three providers through **one OIDC layer** (Auth0, Firebase Auth, or AWS Cognito) via `expo-auth-session` — one integration in-app, provider config lives in the broker. Note: **Apple's App Store rules require Sign in with Apple if you offer Google/Microsoft login on iOS** — already covered since Apple is in scope.
- **Forms:** `react-hook-form` + `zod` schemas (share the same zod schemas with the backend for validation parity)
- **Offline store / sign queue:** `expo-sqlite` (or WatermelonDB if sync complexity grows)
- **PDF render:** `expo-print` (HTML/CSS template → PDF) — logo embedded as base64; page footer/numbering via CSS
- **Crypto:** `react-native-quick-crypto` for binary SHA-256 of the PDF (queue integrity + verifying the signed PDF returned by the backend; needs dev client — fine on EAS)
- **Device features:** `expo-camera` (photos + barcode scan), `expo-location` (GPS w/ consent), `expo-local-authentication` (biometric re-prompt before signing), `expo-secure-store` (tokens)
- **EAS:** `development`, `preview` (internal APK/TestFlight), `production` profiles in `eas.json`; secrets via EAS environment variables — **no API keys in the app bundle**

### Backend
- **Signing service:** Python **FastAPI + pyHanko** (best open-source PAdES + RFC 3161 support), keys in **AWS KMS or Azure Key Vault**, TSA: a public trusted timestamp authority
- **Main API:** same FastAPI service to start (auth verification via broker JWKS, form ingestion, audit log, Claude proxy); split later if needed
- **DB:** Postgres; audit table is append-only (no UPDATE/DELETE grants)
- **Claude integration:** Anthropic Messages API server-side (see https://docs.claude.com/en/api/overview); prompt versioned in repo; structured JSON verdict

## Build milestones

1. **Scaffold:** `npx create-expo-app prowalco-cal -t` (TypeScript) → `eas init` → dev build on device; repo with this CLAUDE.md at root
2. **Auth:** broker setup + all three providers signing in on the dev build; session → backend JWT verification
3. **Form:** all six sections with zod validation, auto-calculated error/pass-fail fields, offline draft persistence
4. **PDF:** HTML certificate template (Prowalco logo, SANAS-style layout) rendered via expo-print; pixel-review against the sample cert
5. **Signing + offline queue:** FastAPI + pyHanko + KMS + TSA; durable sign queue with state machine, idempotency, retry-on-reconnect; airplane-mode test (sign offline → reconnect → certificate issues exactly once); verify green tick in Adobe Reader
6. **Claude analysis:** backend endpoint + in-app verdict card before signing; manager notification on marginal/fail/anomaly
7. **Audit & hardening:** append-only log, POPIA consent flows, key rotation runbook, e-signature procedure doc for the assessor

## Future state (post-PoC): On Key work order integration

**Not built in the PoC** — but the PoC is designed so this slots in without rework.

### Target experience
1. Technician logs in → home screen lists **open work orders assigned to them** (synced from On Key)
2. Technician selects a WO → **customer, site address, asset/UUT details prepopulate** from On Key's asset register (fields render prefilled + locked, with an "override" affordance that logs a discrepancy flag)
3. Technician completes calibration + signing as in PoC
4. On issue: **write-back to On Key** — attach the signed PDF to the WO, post feedback/close-out status, and record the certificate number against the asset

### Integration design
- On Key exposes an **OpenAPI-compliant REST API** (plus an iPaaS layer, "On Key Integrate") — integration goes **backend-to-backend only**; the mobile app never talks to On Key directly and holds no On Key credentials
- Backend adapter behind a **`WorkOrderProvider` interface** (`listAssignedWorkOrders(technicianId)`, `getWorkOrderDetail(woId)`, `attachCertificate(woId, pdf, meta)`, `closeOut(woId, feedback)`) — PoC ships a `ManualEntryProvider`; future adds `OnKeyProvider`. Nothing else changes.
- **Offline:** assigned WOs sync to the device on login/refresh into the same SQLite store, so WO selection and prefill work at zero-signal forecourts; write-back rides the existing sign-queue retry machinery
- **Identity mapping:** technician's IdP identity (Microsoft/Google/Apple subject) must map to their On Key resource/labour record — maintain a mapping table server-side
- Audit trail gains: WO ID, On Key asset ID, prefill snapshot (what On Key said at sync time), and any technician overrides

### PoC design hooks (do these NOW, they're cheap)
- Keep `work order / job number` as a first-class field on the certificate and in the audit log
- Customer/site/asset fields accept a `prefilled: boolean` + `source: 'manual' | 'onkey'` flag in the form schema from day one
- Use stable internal IDs for customers/assets rather than matching on free-text names
- Version the form schema (`schemaVersion` in the payload) so prefill-era certificates coexist with manual-era ones

## Open questions for Prowalco

1. Exact tolerance classes / NRCS requirements per dispenser type?
2. Is Prowalco pursuing SANAS accreditation for this activity, or is this a non-accredited service certificate? (Changes wording + marks on the cert)
3. One signatory or two (calibrated-by + technical signatory)?
4. Existing CRM/job-card system to integrate for customer data?
5. Certificate numbering scheme and branch codes?
6. On Key: which version/hosting (cloud or on-prem), is API access licensed, and who administers it? Request API credentials + the WO and asset-register field schema early.
7. On Key write-back scope: attach PDF only, or also close out the WO / update asset meta?
8. How are technicians identified in On Key (employee code?) for the IdP-to-On-Key mapping?

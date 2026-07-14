# Electronic Signature Procedure — Prowalco Calibration Certificates

**Document status:** DRAFT for review by Prowalco QM and the accreditation
assessor. This procedure is audited as much as the technology (CLAUDE.md,
non-functional requirements).

## 1. Purpose and scope

Defines how calibration certificates produced with the Prowalco calibration
app are electronically signed, timestamped, stored, and amended, in support of
ISO/IEC 17025-style traceability. It covers the mobile app, the signing
service, and the audit trail.

## 2. Roles

| Role | Responsibility |
|---|---|
| Technician (calibrated-by) | Performs the calibration, completes the form, initiates signing after a biometric/PIN identity re-confirmation |
| Technical signatory | Named reviewer on the certificate (two-role model; may be the same person if policy allows — open question #3) |
| Quality manager | Owns tolerance configuration, uncertainty budget, procedure register, and this document |
| System (signing service) | Applies the cryptographic signature; no human holds the signing key |

## 3. What constitutes the signature

1. **Intent to sign.** The technician ticks the declaration ("I certify these
   results are true and the procedure was followed"), passes a device
   biometric/PIN re-prompt, and the app records the intent-to-sign event
   (device timestamp, device ID, GPS with consent).
2. **Cryptographic signature.** The signing service — after re-validating the
   form against the shared schema, re-computing all results, and
   cross-checking the PDF text layer against the submitted data — applies a
   **PAdES** digital signature with a visible widget (technician name +
   signing date) using a private key held in **cloud KMS/HSM**. Keys never
   exist on any device.
3. **Trusted time.** When configured, an **RFC 3161** timestamp from a trusted
   TSA is embedded. The visible signature date on the PDF is the TSA date.

A certificate exists **only** as the signed PDF. Unsigned output is never
distributed and is not a certificate.

## 4. Offline signing semantics (assessor-relevant)

Technicians work at forecourts with poor connectivity. When signing is queued
offline, the audit trail records **both**:

- the technician's **intent-to-sign time** (device clock, at the biometric
  prompt), and
- the **cryptographic signing time** (TSA / server, when the package uploads).

A client-generated idempotency UUID guarantees retries never double-sign or
double-issue: the server replays the stored result for a repeated key.

## 5. Validation before signature

The signing service refuses to sign unless ALL of the following hold:

1. The bearer token verifies against the identity broker (JWKS) and the token
   subject matches the `calibratedBy` identity on the form.
2. The form validates against the shared schema (the same zod contract the
   app uses, re-checked server-side via exported JSON Schema).
3. Cross-field rules pass: declaration ticked, reference standards in date on
   the calibration date, as-left present iff an adjustment was performed,
   calibration date not in the future.
4. Every result row's error (mL), error (%), and pass/fail flag matches a
   server-side recomputation against the tolerance classes in force.
5. The uploaded PDF's SHA-256 matches the client-stated digest.
6. The PDF text layer contains the certificate number, technician name,
   customer name, UUT serial number, and every indicated/measured volume —
   a compromised client cannot get arbitrary content signed.

Refusals are themselves audit events (`certificate.sign_rejected`).

## 6. Audit trail (per certificate)

Certificate number; technician identity (IdP subject + name) and auth method;
device ID; intent-to-sign timestamp and GPS (with consent, POPIA); unsigned
and signed PDF SHA-256; signature ID; signing time; Claude analysis verdict +
model + prompt version; sync confirmation. The audit table is **append-only**
(no UPDATE/DELETE grants; belt-and-braces trigger — see
`backend/migrations/001_init.sql`).

## 7. Claude analysis is advisory

The automated review verdict is shown to the technician before signing and
logged in the audit trail, and managers are notified on `marginal`, `fail`,
or `data_anomaly`. **The human signatory remains responsible for the
certificate.** The analysis never gates or applies a signature.

## 8. Amendments

A signed certificate is immutable. Corrections are made by issuing a **new
certificate number** whose record references the superseded number
(`supersedes` column); the original record and its audit trail are retained
unchanged for the full retention period.

## 9. Retention

Signed PDFs and audit records are retained for at least 5 years (per lab
policy — confirm with QM) in write-once storage.

## 10. Certificate chain

v1 uses an internal CA (to be validated with the accreditation assessor),
with an upgrade path to a public/qualified CA. Key custody and rotation:
`docs/key-rotation-runbook.md`.

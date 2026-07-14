# Prowalco Calibration App

Mobile app + backend for Prowalco (Tatsuno fuel dispenser distributor, South
Africa): field technicians complete a structured calibration form on-site,
issue a **digitally signed, tamper-evident PDF calibration certificate**, and
get an advisory **Claude review** of the results before signing.

Full project brief: [CLAUDE.md](CLAUDE.md). Assessor-facing docs:
[docs/e-signature-procedure.md](docs/e-signature-procedure.md) and
[docs/key-rotation-runbook.md](docs/key-rotation-runbook.md).

**Platform: Supabase** — Postgres (certificates + append-only audit),
a private Storage bucket (signed PDFs), and Supabase Auth (Microsoft/Google/
Apple sign-in). Setup guide: [docs/supabase-setup.md](docs/supabase-setup.md).
The FastAPI signing service fronts all of it; the app never touches the
database or bucket directly, and PostgREST access is blocked by RLS.

## Repository layout

```
shared/schema/   Shared zod schemas + tolerance math (TypeScript).
                 Single source of truth for the form, sign envelope, queue
                 state machine, and Claude verdict. Exports JSON Schema
                 (shared/schema/json/) so the Python backend validates the
                 exact same contract — validation parity by construction.
mobile/          Expo app (dev-client workflow, EAS profiles in eas.json):
                 Supabase Auth sign-in (PKCE), six-section form
                 (react-hook-form + zod), expo-sqlite offline store, durable
                 sign queue with idempotent retry, expo-print PDF template.
backend/         FastAPI: Supabase JWT verification, schema re-validation,
                 server-side result recomputation, PDF text-layer cross-check,
                 PAdES signing (pyHanko, KMS-ready key provider, RFC 3161 TSA
                 hook), append-only audit trail (Supabase Postgres), signed
                 PDFs in Supabase Storage, Claude analysis proxy.
docs/            E-signature procedure, key rotation runbook, Supabase setup.
```

## Backend — run locally

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python scripts/generate_dev_signing_cert.py   # dev-only signing key
cp .env.example .env                                    # defaults are dev-safe
.venv/bin/uvicorn app.main:app --reload
```

The dev defaults (SQLite, PDFs in the DB, auth disabled) need no external
services. For production, point it at Supabase — database, storage bucket,
and auth mode — following [docs/supabase-setup.md](docs/supabase-setup.md).

Tests (37, including a full sign flow that validates the PAdES signature on
the output PDF, idempotent replay, cross-check rejection, Supabase Storage
round-trips, and Supabase JWT verification):

```bash
.venv/bin/python -m pytest tests/ -q
```

Claude analysis needs `ANTHROPIC_API_KEY` in the environment (model +
prompt version are logged to the audit trail; prompt lives in
`backend/app/prompts/`). Everything else works without it.

## Shared schema — build & test

```bash
npm run schema:test     # 19 tests: tolerance math, readiness gate, state machine
npm run schema:export   # regenerate shared/schema/json/*.schema.json after edits
```

The backend's Python tolerance/readiness mirrors are parity-tested against
the same expectations (`backend/tests/test_tolerance.py`).

## Mobile — run on a device

Requires an **EAS development build** (native modules: quick-crypto,
biometrics), not Expo Go:

```bash
cd mobile
npm install
eas build --profile development --platform android   # or ios
npm start
```

Configure per-profile env in `mobile/eas.json`: `EXPO_PUBLIC_API_URL`,
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (Supabase Auth
federates Microsoft/Google/Apple — enable the providers per
docs/supabase-setup.md), `EXPO_PUBLIC_BRANCH_CODE`. Replace the placeholder
logo in `mobile/assets/logo-base64.ts` with the client asset.

## Signing flow (one paragraph)

App renders the certificate PDF → technician passes biometric → intent-to-
sign (device time + optional GPS with POPIA consent) + PDF + SHA-256 +
idempotency UUID are written to a durable SQLite queue → on connectivity the
package uploads → backend re-validates the schema, recomputes every result
row, verifies the PDF hash, cross-checks the PDF text layer, then applies a
PAdES signature (KMS-held key, visible widget, RFC 3161 TSA when configured)
and writes append-only audit events → app verifies the returned hash, stores
the signed PDF, confirms the receipt (SYNCED). Retries are idempotent: a
certificate is issued exactly once.

## Milestone status (per CLAUDE.md)

| # | Milestone | Status |
|---|---|---|
| 1 | Scaffold (repo, Expo app, EAS profiles) | ✅ code in repo; run `eas init` against Prowalco's EAS account |
| 2 | Auth (broker + 3 providers) | ✅ Supabase Auth wired app + backend; enable Azure/Google/Apple providers in the dashboard |
| 3 | Form (6 sections, computed fields, offline drafts) | ✅ |
| 4 | PDF template (SANAS-style, expo-print) | ✅ template built; pixel-review against sample cert pending |
| 5 | Signing + offline queue (pyHanko, idempotency, retries) | ✅ backend tested end-to-end; KMS + production TSA are deploy-time config; airplane-mode device test pending |
| 6 | Claude analysis + verdict card + manager notify | ✅ (notification channel is a logging stub) |
| 7 | Audit & hardening (append-only, POPIA consent, runbooks) | ✅ docs + migration written |

Open questions for Prowalco are tracked at the bottom of CLAUDE.md — the
tolerance MPE values and the uncertainty statement are explicitly marked
PROVISIONAL until confirmed by the quality manager.

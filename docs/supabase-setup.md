# Supabase Setup — Prowalco Calibration App

Supabase provides three things for this system:

| Piece | Used for |
|---|---|
| **Postgres** | Certificates, append-only audit trail, number sequences |
| **Storage** (private bucket) | Signed certificate PDFs |
| **Auth** | Sign-in broker federating Microsoft (Azure), Google, Apple |

The FastAPI signing service remains in front of all three — the mobile app
never talks to the database or the bucket directly, and PostgREST access to
the tables is locked out by RLS. Supabase Auth is the only piece the app
touches directly (sign-in), holding just the publishable anon key.

## 1. Create the project

1. Create a project at https://supabase.com/dashboard (pick a region close to
   South Africa, e.g. `eu-west` or `af-south` if offered).
2. Note from **Project Settings**:
   - Project URL → `SUPABASE_URL` (backend) and `EXPO_PUBLIC_SUPABASE_URL` (app)
   - `anon` publishable key → `EXPO_PUBLIC_SUPABASE_ANON_KEY` (app only)
   - `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY` (**backend only,
     never in the app**)
   - Database password (set at creation) → used in `DATABASE_URL`

## 2. Database

1. Set the backend's `DATABASE_URL` to the **session pooler** connection
   string (Dashboard → Connect → Session pooler), with the SQLAlchemy driver
   prefix and TLS:

   ```
   DATABASE_URL=postgresql+psycopg2://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
   ```

   Use the session pooler (port 5432), not the transaction pooler (6543) —
   SQLAlchemy's default prepared-statement behaviour is not compatible with
   transaction-mode PgBouncer.
2. Apply the schema (idempotent — also creates the storage bucket):

   ```bash
   cd backend && .venv/bin/python scripts/apply_migrations.py
   ```

   (Equivalently, paste `backend/migrations/001_init.sql` into the SQL
   editor.) This creates the three tables, enables deny-all RLS (blocks the
   auto-generated REST API), and installs the append-only triggers on
   `certificates` and `audit_events`. The API also verifies all of this at
   startup and refuses to boot if anything is missing.

## 3. Storage

1. **Storage → New bucket**: name `certificates`, **Private** (do NOT enable
   public access).
2. Do not add any RLS policies to the bucket — with no policies, only the
   service role (the backend) can read or write objects, which is exactly the
   intent. Signed PDFs reach users only through the backend, which logs every
   access to the audit trail.
3. Backend env: `PDF_STORAGE=supabase`, `SUPABASE_STORAGE_BUCKET=certificates`.

Immutability note: the backend uploads with `x-upsert: false` and never
writes the same path twice after issue (enforced by DB idempotency), and
every issue event records the PDF SHA-256 in the append-only audit table, so
any later substitution of an object would be detectable. For stronger
write-once guarantees at the storage layer, mirror issued PDFs to S3 Object
Lock as a post-PoC hardening step.

## 4. Auth (sign-in providers)

1. **Authentication → Sign In / Up → Providers**: enable
   - **Azure** (Microsoft work accounts) — create an Entra ID app
     registration, supply client ID + secret, set the tenant.
   - **Google** — OAuth client ID + secret from Google Cloud Console.
   - **Apple** — Services ID, team ID, key ID + private key from the Apple
     Developer portal. (Required on iOS since Google/Microsoft login is
     offered.)
2. **Authentication → URL Configuration**: add the app's redirect URL to the
   allow-list: `prowalco-cal://auth-callback` (plus the Expo dev-client URL
   printed by `npx expo start` during development).
3. **JWT keys**: use asymmetric **JWT signing keys** (Project Settings → JWT
   Keys → migrate if the project still shows a legacy secret). The backend
   then verifies tokens against the project JWKS with zero shared secrets.
   If you must stay on the legacy shared secret temporarily, set
   `SUPABASE_JWT_SECRET` on the backend instead.

Only Azure/Google/Apple identities are accepted by the backend — tokens from
any other provider (e.g. email/password sign-ups) are rejected with 403
(`backend/app/auth.py`).

**Test account note:** the test suite provisions one technician account
(`calibration-e2e@example.com`) through the Auth admin API, tagged with an
`azure` provider in its app metadata, and signs in with the password grant —
so the **email provider must remain enabled** in Supabase Auth (it is by
default). End users can never reach the backend with plain email identities.

## 5. Backend `.env` (summary — same in every environment)

```
DATABASE_URL=postgresql+psycopg2://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_STORAGE_BUCKET=certificates
SIGNING_KEY_PROVIDER=local            # → aws_kms once KMS is provisioned
TSA_URL=<rfc3161 endpoint>
ANTHROPIC_API_KEY=<key>
```

There is no dev mode: the API refuses to start, and the test suite refuses
to run, without a reachable Supabase project. Tests run against this same
project (schema application is idempotent; test certificates use random
numbers and land in the same append-only tables and bucket — use a separate
Supabase project for CI/testing if you want to keep production data
pristine, but the architecture is identical either way).

## 6. What does NOT move to Supabase

- **PAdES signing keys** — cloud KMS/HSM (AWS KMS / Azure Key Vault), per
  docs/key-rotation-runbook.md. Supabase has no HSM signing primitive.
- **The Anthropic API key** — backend environment only.
- **The signing/validation logic** — a certificate is only issued through
  the FastAPI service; Supabase is storage + identity, not the trust anchor.

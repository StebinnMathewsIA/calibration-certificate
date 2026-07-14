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

1. Open the **SQL editor** and run `backend/migrations/001_init.sql` in full.
   This creates the three tables, enables deny-all RLS (blocks the
   auto-generated REST API), and installs the append-only triggers on
   `certificates` and `audit_events`.
2. Set the backend's `DATABASE_URL` to the **session pooler** connection
   string (Dashboard → Connect → Session pooler), with the SQLAlchemy driver
   prefix and TLS:

   ```
   DATABASE_URL=postgresql+psycopg2://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
   ```

   Use the session pooler (port 5432), not the transaction pooler (6543) —
   SQLAlchemy's default prepared-statement behaviour is not compatible with
   transaction-mode PgBouncer.

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
4. Backend env: `AUTH_MODE=supabase`.

Only Azure/Google/Apple identities are accepted by the backend — tokens from
any other provider (e.g. email/password sign-ups) are rejected with 403
(`backend/app/auth.py`).

## 5. Backend `.env` for production (summary)

```
DATABASE_URL=postgresql+psycopg2://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
AUTH_MODE=supabase
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
PDF_STORAGE=supabase
SUPABASE_STORAGE_BUCKET=certificates
SIGNING_KEY_PROVIDER=local            # → aws_kms once KMS is provisioned
TSA_URL=<rfc3161 endpoint>
ANTHROPIC_API_KEY=<key>
```

## 6. What does NOT move to Supabase

- **PAdES signing keys** — cloud KMS/HSM (AWS KMS / Azure Key Vault), per
  docs/key-rotation-runbook.md. Supabase has no HSM signing primitive.
- **The Anthropic API key** — backend environment only.
- **The signing/validation logic** — a certificate is only issued through
  the FastAPI service; Supabase is storage + identity, not the trust anchor.

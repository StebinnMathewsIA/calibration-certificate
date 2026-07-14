/**
 * Durable local store (expo-sqlite). Every sign-queue state survives app
 * kill/restart — see the state machine in @prowalco/schema (envelope.ts).
 */
import * as SQLite from 'expo-sqlite';

export const db = SQLite.openDatabaseSync('prowalco.db');

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS certificates (
     id TEXT PRIMARY KEY,
     certificate_number TEXT UNIQUE,
     state TEXT NOT NULL DEFAULT 'DRAFT',
     form_json TEXT NOT NULL,
     -- sign package (populated at QUEUED_FOR_SIGNING)
     idempotency_key TEXT,
     pdf_uri TEXT,
     pdf_sha256 TEXT,
     intent_json TEXT,
     -- result (populated at SIGNED)
     signed_pdf_uri TEXT,
     signed_pdf_sha256 TEXT,
     signature_id TEXT,
     signed_at TEXT,
     -- retry bookkeeping
     retry_count INTEGER NOT NULL DEFAULT 0,
     next_retry_at TEXT,
     last_error TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS analysis_results (
     certificate_id TEXT PRIMARY KEY,
     response_json TEXT NOT NULL,
     created_at TEXT NOT NULL
   );`,
];

export function migrate(): void {
  db.execSync('PRAGMA journal_mode = WAL;');
  for (const sql of MIGRATIONS) db.execSync(sql);
}

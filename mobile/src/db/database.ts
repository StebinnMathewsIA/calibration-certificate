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
  // Read-through cache for work orders / sites / dispensers / registers so
  // forecourt work needs no signal (CLAUDE.md offline requirement). Keyed by
  // a logical cache key, e.g. "workorders", "workorder:WO-001",
  // "dispenser-detail:DISP-001".
  `CREATE TABLE IF NOT EXISTS api_cache (
     cache_key TEXT PRIMARY KEY,
     value_json TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );`,
];

/** SQLite has no ADD COLUMN IF NOT EXISTS — guard with the table info. */
function addColumnIfMissing(table: string, column: string, ddl: string): void {
  const cols = db.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!cols.some((c) => c.name === column)) {
    db.execSync(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

export function migrate(): void {
  db.execSync('PRAGMA journal_mode = WAL;');
  for (const sql of MIGRATIONS) db.execSync(sql);
  // Drafts archived when their work order closes (#31).
  addColumnIfMissing('certificates', 'archived_at', 'TEXT');
}

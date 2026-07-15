import * as Crypto from 'expo-crypto';
import type { CertificateState, IntentToSign, Verification } from '@prowalco/schema';
import { canTransition } from '@prowalco/schema';
import { db } from './database';

export interface CertificateRecord {
  id: string;
  certificateNumber: string | null;
  state: CertificateState;
  form: Partial<Verification>;
  idempotencyKey: string | null;
  pdfUri: string | null;
  pdfSha256: string | null;
  intent: IntentToSign | null;
  signedPdfUri: string | null;
  signedPdfSha256: string | null;
  signatureId: string | null;
  signedAt: string | null;
  retryCount: number;
  nextRetryAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

type Row = Record<string, unknown>;

function fromRow(r: Row): CertificateRecord {
  return {
    id: r.id as string,
    certificateNumber: (r.certificate_number as string) ?? null,
    state: r.state as CertificateState,
    form: JSON.parse(r.form_json as string),
    idempotencyKey: (r.idempotency_key as string) ?? null,
    pdfUri: (r.pdf_uri as string) ?? null,
    pdfSha256: (r.pdf_sha256 as string) ?? null,
    intent: r.intent_json ? JSON.parse(r.intent_json as string) : null,
    signedPdfUri: (r.signed_pdf_uri as string) ?? null,
    signedPdfSha256: (r.signed_pdf_sha256 as string) ?? null,
    signatureId: (r.signature_id as string) ?? null,
    signedAt: (r.signed_at as string) ?? null,
    retryCount: (r.retry_count as number) ?? 0,
    nextRetryAt: (r.next_retry_at as string) ?? null,
    lastError: (r.last_error as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

const now = () => new Date().toISOString();

export function createDraft(certificateNumber: string | null, form: Partial<Verification>): string {
  const id = Crypto.randomUUID();
  db.runSync(
    `INSERT INTO certificates (id, certificate_number, state, form_json, created_at, updated_at)
     VALUES (?, ?, 'DRAFT', ?, ?, ?)`,
    [id, certificateNumber, JSON.stringify(form), now(), now()],
  );
  return id;
}

export function getById(id: string): CertificateRecord | null {
  const row = db.getFirstSync<Row>('SELECT * FROM certificates WHERE id = ?', [id]);
  return row ? fromRow(row) : null;
}

export function listAll(): CertificateRecord[] {
  return db
    .getAllSync<Row>('SELECT * FROM certificates ORDER BY created_at DESC')
    .map(fromRow);
}

export function listInState(state: CertificateState): CertificateRecord[] {
  return db
    .getAllSync<Row>('SELECT * FROM certificates WHERE state = ? ORDER BY created_at', [state])
    .map(fromRow);
}

export function saveDraftForm(id: string, form: Partial<Verification>): void {
  // Any edit puts the certificate back into DRAFT (READY_TO_SIGN is only a
  // validation gate, never a resting place for edited content).
  db.runSync(
    `UPDATE certificates SET form_json = ?, state = 'DRAFT', updated_at = ? WHERE id = ?`,
    [JSON.stringify(form), now(), id],
  );
}

export function transition(id: string, to: CertificateState, patch: Record<string, unknown> = {}): void {
  const rec = getById(id);
  if (!rec) throw new Error(`Certificate ${id} not found`);
  if (!canTransition(rec.state, to)) {
    throw new Error(`Illegal state transition ${rec.state} -> ${to}`);
  }
  const columns = Object.keys(patch);
  const sets = ['state = ?', 'updated_at = ?', ...columns.map((c) => `${c} = ?`)];
  db.runSync(`UPDATE certificates SET ${sets.join(', ')} WHERE id = ?`, [
    to,
    now(),
    ...columns.map((c) => patch[c] as never),
    id,
  ]);
}

export function recordRetryFailure(id: string, error: string): void {
  const rec = getById(id);
  if (!rec) return;
  const retryCount = rec.retryCount + 1;
  // Exponential backoff: 30s, 60s, 2m, 4m ... capped at 15 minutes.
  const delayMs = Math.min(30_000 * 2 ** (retryCount - 1), 15 * 60_000);
  db.runSync(
    `UPDATE certificates SET retry_count = ?, next_retry_at = ?, last_error = ?, updated_at = ? WHERE id = ?`,
    [retryCount, new Date(Date.now() + delayMs).toISOString(), error, now(), id],
  );
}

export function saveAnalysis(certificateId: string, responseJson: string): void {
  db.runSync(
    `INSERT OR REPLACE INTO analysis_results (certificate_id, response_json, created_at)
     VALUES (?, ?, ?)`,
    [certificateId, responseJson, now()],
  );
}

export function getAnalysis(certificateId: string): string | null {
  const row = db.getFirstSync<Row>(
    'SELECT response_json FROM analysis_results WHERE certificate_id = ?',
    [certificateId],
  );
  return row ? (row.response_json as string) : null;
}

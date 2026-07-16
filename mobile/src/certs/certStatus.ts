/**
 * Per-dispenser certificate status, derived from the certificates issued on
 * this device (certificateRepo). For each dispenser we take the most recent
 * issued verification and classify it:
 *   - valid     — all hoses certified and not past the expiry date
 *   - expired   — all hoses certified but the expiry date has passed
 *   - rejected  — at least one hose was rejected
 *   - none      — no issued certificate on this device yet
 */
import type { Verification } from '@prowalco/schema';
import * as repo from '../db/certificateRepo';

export type CertState = 'valid' | 'expired' | 'rejected' | 'none';

export interface DispenserCert {
  state: CertState;
  certificateNumber?: string;
  expiryDate?: string;
  signedAt?: string;
  recordId?: string;
}

function classify(v: Verification, today: string): Exclude<CertState, 'none'> {
  const anyRejected = v.hoses.some((h) => h.outcome === 'rejected');
  if (anyRejected) return 'rejected';
  const expiry = v.signOff?.expiryDate;
  if (expiry && expiry < today) return 'expired';
  return 'valid';
}

/** Latest issued certificate status for each dispenser id (keyed by id). */
export function certStatusByDispenser(now: Date = new Date()): Record<string, DispenserCert> {
  const today = now.toISOString().slice(0, 10);
  const issued = repo
    .listAll()
    .filter((r) => (r.state === 'SIGNED' || r.state === 'SYNCED') && r.signedAt);

  const byDispenser: Record<string, DispenserCert> = {};
  for (const r of issued) {
    const v = r.form as Partial<Verification>;
    const dispenserId = v.dispenser?.dispenserId;
    if (!dispenserId || !v.hoses) continue;
    const prev = byDispenser[dispenserId];
    if (prev?.signedAt && r.signedAt && prev.signedAt >= r.signedAt) continue; // keep the latest
    byDispenser[dispenserId] = {
      state: classify(v as Verification, today),
      certificateNumber: r.certificateNumber ?? undefined,
      expiryDate: v.signOff?.expiryDate,
      signedAt: r.signedAt ?? undefined,
      recordId: r.id,
    };
  }
  return byDispenser;
}

export const CERT_LABEL: Record<CertState, string> = {
  valid: 'Valid certificate',
  expired: 'Expired',
  rejected: 'Rejected',
  none: 'No certificate',
};

export const CERT_TONE: Record<CertState, 'ok' | 'warn' | 'bad' | 'muted'> = {
  valid: 'ok',
  expired: 'warn',
  rejected: 'bad',
  none: 'muted',
};

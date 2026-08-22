/**
 * The technician's own profile (display name, VO pliers number and their
 * saved handwritten signature) kept on-device, per IdP subject. The VO
 * signature is embedded into every certificate they sign so the signature on
 * the document looks like theirs.
 */
import { readCache, writeCache } from '../db/cache';

/** Offline mirror of one ACTIVE certified measure (#70). Source of truth is
 * the server's technician_measures register; this copy powers the offline
 * verification gate. Photos live in `measurePhotos`, keyed by size. */
export interface StoredMeasure {
  size: string; // '200L' | '20L' | '5L'
  serialNumber: string;
  certificateNumber: string;
  calibrationDate?: string | null; // YYYY-MM-DD
  expiryDate: string; // YYYY-MM-DD
  photoUri?: string;
}

export interface TechProfile {
  /** First name(s), e.g. "Stebin". */
  firstName?: string;
  /** Surname, e.g. "Mathews". */
  lastName?: string;
  /** Legacy single-field name; kept as a fallback for older profiles. */
  displayName?: string;
  /** VO Pliers No. */
  pliersNumber?: string;
  /** The VO's drawn signature as a standalone SVG string. */
  signatureSvg?: string;
  /** Offline mirror of the VO's ACTIVE certified measures (#70). */
  measures?: StoredMeasure[];
  /** Device-local photos of the measures, keyed by size (#48/#70). */
  measurePhotos?: Record<string, string>;
}

/** The VO name as printed on the certificate: the document's field is
 * labelled "Initial & Surname", e.g. "S. Mathews". Falls back to the legacy
 * display name, then the sign-in name. */
export function certificateName(p: TechProfile, fallback: string): string {
  const first = (p.firstName ?? '').trim();
  const last = (p.lastName ?? '').trim();
  if (first || last) {
    const initials = first
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `${w[0].toUpperCase()}.`)
      .join(' ');
    return [initials, last].filter(Boolean).join(' ');
  }
  return p.displayName || fallback;
}

/** Two-letter avatar initials from the profile's real name parts; null when
 * neither part is set (caller falls back to guessing from a display name). */
export function profileInitials(p: TechProfile): string | null {
  const first = (p.firstName ?? '').trim();
  const last = (p.lastName ?? '').trim();
  if (first && last) return (first[0] + last[0]).toUpperCase();
  if (first || last) return (first || last).slice(0, 2).toUpperCase();
  return null;
}

/** Seed the real name parts from an IdP sign-in. Never overwrites a name the
 * VO typed themselves: only fills a profile that has neither part. */
export function seedProfileName(subject: string, firstName: string, lastName: string): void {
  if (!firstName && !lastName) return;
  const p = getProfile(subject);
  if (p.firstName || p.lastName) return;
  saveProfile(subject, {
    ...p,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    displayName: [firstName, lastName].filter(Boolean).join(' '),
  });
}

const key = (subject: string) => `profile:${subject}`;

export function getProfile(subject: string): TechProfile {
  return readCache<TechProfile>(key(subject)) ?? {};
}

export function saveProfile(subject: string, profile: TechProfile): void {
  writeCache(key(subject), profile);
}

/** Cache key the signature-capture screen writes the VO's drawn signature to. */
export const voSignatureCacheKey = (subject: string) => `profile-signature:${subject}`;

/** What is missing from a technician's profile that will stop them
 * mid-job (#128). Returned as sentences, because the caller shows them to
 * the person who has to fix it.
 *
 * The signature is the only entry today. It is here rather than inline in
 * the header so that the next gate (a missing certificate name, say) is
 * added in one place and appears everywhere the marker does. */
export function profileGaps(
  subject: string,
  read: <T>(key: string) => T | null,
): string[] {
  if (!subject) return [];
  const gaps: string[] = [];
  const signature = read<string>(voSignatureCacheKey(subject));
  if (!signature) gaps.push('Your signature is not on your profile');
  return gaps;
}

/** Certified-measures state for the avatar badge (#211): red when a size
 * is missing or expired (blocks a test plan), amber when only expiring
 * within 30 days. Null when everything is current. Mirrors the plan-scoped
 * gate's data (#197) without deciding for it. */
export function measuresStatus(
  subject: string,
): { blocking: boolean; text: string } | null {
  if (!subject) return null;
  const active = getProfile(subject).measures ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const missing = ['200L', '20L', '5L'].filter((s) => !active.some((m) => m.size === s));
  const expired = active.filter((m) => m.expiryDate < today);
  const expiring = active.filter((m) => m.expiryDate >= today && m.expiryDate <= soon);
  if (missing.length + expired.length + expiring.length === 0) return null;
  return {
    blocking: missing.length > 0 || expired.length > 0,
    text: [
      ...missing.map((s) => `${s} not registered`),
      ...expired.map((m) => `${m.size} expired ${m.expiryDate}`),
      ...expiring.map((m) => `${m.size} expires ${m.expiryDate}`),
    ].join(' · '),
  };
}

/** True when this technician can put their name to a document. */
export function hasProfileSignature(
  subject: string,
  read: <T>(key: string) => T | null,
): boolean {
  return !!subject && !!read<string>(voSignatureCacheKey(subject));
}

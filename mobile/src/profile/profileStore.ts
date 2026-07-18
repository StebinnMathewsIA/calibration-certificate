/**
 * The technician's own profile — display name, VO pliers number and their
 * saved handwritten signature — kept on-device (per IdP subject). The VO
 * signature is embedded into every certificate they sign so the signature on
 * the document looks like theirs.
 */
import { readCache, writeCache } from '../db/cache';

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
}

/** The VO name as printed on the certificate — the document's field is
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
 * VO typed themselves — only fills a profile that has neither part. */
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

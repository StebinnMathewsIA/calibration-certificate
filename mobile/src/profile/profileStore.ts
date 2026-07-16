/**
 * The technician's own profile — display name, VO pliers number and their
 * saved handwritten signature — kept on-device (per IdP subject). The VO
 * signature is embedded into every certificate they sign so the signature on
 * the document looks like theirs.
 */
import { readCache, writeCache } from '../db/cache';

export interface TechProfile {
  /** Name shown as the VO on the certificate (defaults to the sign-in name). */
  displayName?: string;
  /** VO Pliers No. */
  pliersNumber?: string;
  /** The VO's drawn signature as a standalone SVG string. */
  signatureSvg?: string;
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

/**
 * The sign-in display name feeds the certificate's VO "Initial & Surname"
 * field whenever the technician has not filled in their profile
 * (profileStore.certificateName falls back to it) — so it must always look
 * like a person's name, formatted as initials + surname, and never be a raw
 * email address.
 */

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const initialsOf = (given: string): string =>
  given
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => `${p[0].toUpperCase()}.`)
    .join(' ');

/** "Stebinn Mathews" -> "S. Mathews"; "John Peter Smith" -> "J. P. Smith";
 * a single token is returned capitalised as-is. */
export function initialsAndSurname(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return cap(parts[0]);
  const surname = parts[parts.length - 1];
  return `${initialsOf(parts.slice(0, -1).join(' '))} ${cap(surname)}`;
}

/** Last-resort name from an email's mailbox part:
 * "stebinn.mathews@x" -> "S. Mathews"; "stebinn@x" -> "Stebinn". */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local
    .split(/[._-]+/)
    .map((p) => p.replace(/\d+$/, ''))
    .filter(Boolean);
  if (parts.length === 0) return '';
  return initialsAndSurname(parts.map(cap).join(' '));
}

export interface ProfileNameSource {
  givenName?: string;
  familyName?: string;
  fullName?: string;
  email?: string;
}

/** Resolves the signatory name from whatever the IdP provided, in order of
 * fidelity. Falls back to "Technician" only if the profile is completely
 * empty. */
export function signatoryDisplayName(p: ProfileNameSource): string {
  if (p.familyName) {
    const initials = p.givenName ? initialsOf(p.givenName) : '';
    return initials ? `${initials} ${cap(p.familyName)}` : cap(p.familyName);
  }
  if (p.fullName?.trim()) return initialsAndSurname(p.fullName);
  if (p.email) {
    const derived = nameFromEmail(p.email);
    if (derived) return derived;
  }
  return 'Technician';
}

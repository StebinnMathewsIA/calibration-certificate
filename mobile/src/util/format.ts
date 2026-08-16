/** One duration format everywhere (#157, owner decision): hours and
 * minutes ("1 h 30 min", "4 h"), plain minutes only under an hour. */
export function formatDuration(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null;
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

/** "Aug 18, 2026" from an ISO timestamp, for the Complete by cell. */
export function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Whole days overdue relative to now; null when not overdue or unknown. */
export function overdueDays(completeBy: string | null | undefined): number | null {
  if (!completeBy) return null;
  const due = new Date(completeBy).getTime();
  if (Number.isNaN(due)) return null;
  const days = Math.floor((Date.now() - due) / (24 * 3600 * 1000));
  return days > 0 ? days : null;
}

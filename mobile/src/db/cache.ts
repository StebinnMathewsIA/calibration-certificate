/**
 * Read-through cache for OnKey-seed + canonical-store data (work orders,
 * sites, dispensers, component registers) so the app works at zero-signal
 * forecourts. `fetchThrough` returns fresh data when online and caches it;
 * when the request fails it falls back to the last cached value.
 */
import { db } from './database';

type Row = { value_json: string };

export function readCache<T>(key: string): T | null {
  const row = db.getFirstSync<Row>('SELECT value_json FROM api_cache WHERE cache_key = ?', [key]);
  return row ? (JSON.parse(row.value_json) as T) : null;
}

export function writeCache<T>(key: string, value: T): void {
  db.runSync(
    `INSERT OR REPLACE INTO api_cache (cache_key, value_json, updated_at) VALUES (?, ?, ?)`,
    [key, JSON.stringify(value), new Date().toISOString()],
  );
}

/** Try the network; on success cache and return it; on failure return the
 * cached value if we have one, otherwise rethrow. */
export async function fetchThrough<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  try {
    const fresh = await fetcher();
    writeCache(key, fresh);
    return fresh;
  } catch (err) {
    const cached = readCache<T>(key);
    if (cached !== null) return cached;
    throw err;
  }
}

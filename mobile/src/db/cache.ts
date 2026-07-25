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

/** Stale-while-revalidate (Arch v2 phase 2, #66): a cached copy returns
 * INSTANTLY — screens never wait on the network once the mirror is synced —
 * while a background refresh updates the cache for the next open (the sync
 * engine keeps the mirror fresh anyway). Only a cold key awaits the network,
 * and network failure on a cold key surfaces to the caller. */
export async function fetchThrough<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const cached = readCache<T>(key);
  if (cached !== null) {
    fetcher()
      .then((fresh) => writeCache(key, fresh))
      .catch(() => {});
    return cached;
  }
  const fresh = await fetcher();
  writeCache(key, fresh);
  return fresh;
}

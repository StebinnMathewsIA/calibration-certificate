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
 * while a background refresh updates the cache. Only a cold key awaits the
 * network, and network failure on a cold key surfaces to the caller.
 *
 * `opts.onFresh` is how a screen stays current WITHIN one visit. Without
 * it the revalidated value only reached the cache, so the technician saw
 * it on the next open: one whole visit behind the planner. Pass it and
 * the list updates in place the moment the network answers. It fires only
 * when the fresh value actually differs, so it costs no render otherwise.
 *
 * `opts.force` skips the cached copy and awaits the network, for an
 * explicit pull-to-refresh. It still falls back to cache when offline, so
 * refreshing at a dead forecourt does not empty the screen. */
export async function fetchThrough<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: { onFresh?: (fresh: T) => void; force?: boolean } = {},
): Promise<T> {
  const cached = readCache<T>(key);
  if (opts.force) {
    try {
      const fresh = await fetcher();
      writeCache(key, fresh);
      return fresh;
    } catch (err) {
      if (cached !== null) return cached;
      throw err;
    }
  }
  if (cached !== null) {
    const before = JSON.stringify(cached);
    fetcher()
      .then((fresh) => {
        writeCache(key, fresh);
        if (opts.onFresh && JSON.stringify(fresh) !== before) opts.onFresh(fresh);
      })
      .catch(() => {});
    return cached;
  }
  const fresh = await fetcher();
  writeCache(key, fresh);
  return fresh;
}

/** Remove a cached key outright, for when an edit has just made it wrong
 * (an allocation move changes what the stock tab and the tree should
 * show). Dropping beats overwriting here because the next reader takes
 * the fresh network path instead of a stale copy. */
export function dropCache(key: string): void {
  db.runSync('DELETE FROM api_cache WHERE cache_key = ?', [key]);
}

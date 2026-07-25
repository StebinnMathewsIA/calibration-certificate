/**
 * Offline write outbox (Arch v2 phase 2, #66). Writes made at zero-signal
 * forecourts are queued here (with an optimistic cache update applied by the
 * caller) and replayed IN ORDER when connectivity returns. Only network
 * failures queue — a reachable server that rejects a write (4xx/5xx) is a
 * real answer and surfaces to the caller instead.
 *
 * Replay is idempotent by construction: every endpoint is an upsert, and an
 * offline addDispenser carries a client-generated id, so a 409 on replay
 * means "already applied" and the item is dropped as done.
 */
import { db } from '../db/database';
import { ApiError, request } from '../api/http';

export type OutboxKind =
  | 'upsertSite'
  | 'addDispenser'
  | 'editDispenser'
  | 'retireDispenser'
  | 'saveDispenserDetail'
  | 'patchMyTechnician';

interface OutboxRow {
  id: number;
  kind: OutboxKind;
  payload_json: string;
}

export function enqueueWrite(kind: OutboxKind, payload: Record<string, unknown>): void {
  db.runSync('INSERT INTO outbox (kind, payload_json, created_at) VALUES (?, ?, ?)', [
    kind,
    JSON.stringify(payload),
    new Date().toISOString(),
  ]);
}

export function outboxCount(): number {
  const row = db.getFirstSync<{ n: number }>('SELECT count(*) AS n FROM outbox');
  return row?.n ?? 0;
}

async function perform(token: string | null, kind: OutboxKind, p: any): Promise<void> {
  switch (kind) {
    case 'upsertSite':
      await request(`/v1/sites/${encodeURIComponent(p.id)}`, token, {
        method: 'POST',
        body: JSON.stringify(p.body),
      });
      return;
    case 'addDispenser':
      await request('/v1/dispensers', token, { method: 'POST', body: JSON.stringify(p.body) });
      return;
    case 'editDispenser':
      await request(`/v1/dispensers/${encodeURIComponent(p.id)}`, token, {
        method: 'POST',
        body: JSON.stringify(p.body),
      });
      return;
    case 'retireDispenser':
      await request(`/v1/dispensers/${encodeURIComponent(p.id)}/retire`, token, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      return;
    case 'saveDispenserDetail':
      await request(`/v1/dispensers/${encodeURIComponent(p.id)}/detail`, token, {
        method: 'POST',
        body: JSON.stringify(p.body),
      });
      return;
    case 'patchMyTechnician':
      await request('/v1/technicians/me', token, {
        method: 'PATCH',
        body: JSON.stringify(p.body),
      });
      return;
  }
}

/** Replays queued writes oldest-first. Stops at the first NETWORK failure
 * (still offline); drops items the server has answered (2xx, or 409 =
 * already applied on a previous attempt). Other server rejections stay
 * queued with the error recorded, but do not block later items. */
export async function drainOutbox(token: string | null): Promise<void> {
  const rows = db.getAllSync<OutboxRow>(
    'SELECT id, kind, payload_json FROM outbox ORDER BY id',
  );
  for (const row of rows) {
    try {
      await perform(token, row.kind, JSON.parse(row.payload_json));
      db.runSync('DELETE FROM outbox WHERE id = ?', [row.id]);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          db.runSync('DELETE FROM outbox WHERE id = ?', [row.id]);
        } else {
          db.runSync('UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?', [
            JSON.stringify(err.detail).slice(0, 500),
            row.id,
          ]);
        }
        continue;
      }
      return; // network is down — retry the whole tail later
    }
  }
}

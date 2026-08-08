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
import { rpc } from '../api/supabaseRpc';

export type OutboxKind =
  | 'upsertSite'
  | 'addDispenser'
  | 'editDispenser'
  | 'retireDispenser'
  | 'saveDispenserDetail'
  | 'patchMyTechnician'
  | 'addMeasure'
  | 'woTransition'
  | 'woStandDown'
  | 'jobCardSave'
  | 'jobCardSign';

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
    case 'addMeasure':
      await request('/v1/technicians/me/measures', token, {
        method: 'POST',
        body: JSON.stringify(p.body),
      });
      return;
    case 'jobCardSave':
      await rpc('app_job_card_save', token, p.args);
      return;
    case 'jobCardSign':
      await rpc('app_job_card_sign', token, p.args);
      return;
    case 'woStandDown':
      await rpc('app_wo_stand_down', token, p.args);
      return;
    case 'woTransition':
      // Straight to the RPC, unlike the rest: the lifecycle lives in
      // Supabase, not behind a Render endpoint. p_occurred_at carries the
      // moment the technician actually tapped, so a job started at 08:42
      // offline is not recorded as having started when the signal came
      // back.
      await rpc('app_wo_transition', token, {
        p_work_order_id: p.workOrderId,
        p_event: p.event,
        p_reason: p.reason ?? null,
        p_note: p.note ?? null,
        p_device_id: p.deviceId ?? null,
        p_gps: p.gps ?? null,
        p_occurred_at: p.occurredAt ?? null,
      });
      return;
  }
}

/** The work order an item acts on, for ordering. Only lifecycle events
 * need it: the rest are independent upserts. */
function targetOf(kind: OutboxKind, p: any): string | null {
  if (kind === 'woTransition' || kind === 'woStandDown') return String(p.workOrderId);
  // Job card writes belong to the SAME per-work-order sequence: a sign
  // must not overtake the save that put the content there, and neither
  // may pass a lifecycle event the server rejected.
  if (kind === 'jobCardSave' || kind === 'jobCardSign') {
    return String(p.args?.p_work_order_id ?? '');
  }
  return null;
}

/** Replays queued writes oldest-first. Stops at the first NETWORK failure
 * (still offline); drops items the server has answered (2xx, or 409 =
 * already applied on a previous attempt).
 *
 * A server rejection is recorded and skipped rather than retried forever,
 * EXCEPT that a rejected lifecycle event blocks every later event for the
 * SAME work order. Those are a sequence, not independent upserts: if start
 * is rejected because planning recalled the job, replaying the stop behind
 * it would write a finish for work that never officially began. Other work
 * orders are unaffected. */
export async function drainOutbox(token: string | null): Promise<void> {
  const rows = db.getAllSync<OutboxRow>(
    'SELECT id, kind, payload_json FROM outbox ORDER BY id',
  );
  const stuck = new Set<string>();
  for (const row of rows) {
    const payload = JSON.parse(row.payload_json);
    const target = targetOf(row.kind, payload);
    if (target && stuck.has(target)) continue;
    try {
      await perform(token, row.kind, payload);
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
          if (target) stuck.add(target);
        }
        continue;
      }
      return; // network is down — retry the whole tail later
    }
  }
}

/** Lifecycle events the server has rejected, for the screen to surface.
 * A silent queue that never drains is worse than an error: the technician
 * believes the office knows something it does not. */
export function rejectedTransitions(): { workOrderId: string; event: string; error: string }[] {
  const rows = db.getAllSync<{ payload_json: string; last_error: string | null }>(
    "SELECT payload_json, last_error FROM outbox WHERE kind = 'woTransition' AND attempts > 0",
  );
  return rows.map((r) => {
    const p = JSON.parse(r.payload_json);
    return {
      workOrderId: String(p.workOrderId),
      event: String(p.event),
      error: r.last_error ?? 'rejected',
    };
  });
}

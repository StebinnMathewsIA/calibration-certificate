/**
 * Device mirror sync (Arch v2 phase 2, #66). One `app_sync_pull` round trip
 * refreshes every cache key the screens read, so the whole app works — and
 * opens instantly — at zero-signal forecourts. Composes the work-order
 * bundles client-side from the pulled pieces (same shapes as
 * app_work_order_bundle).
 */
import type {
  DispenserResolved,
  MyTechnician,
  SiteResolved,
  WorkOrderSummary,
} from '../api/client';
import { rpc } from '../api/supabaseRpc';
import { writeCache } from '../db/cache';
import { drainOutbox } from './outbox';

interface SyncPull {
  technician: { technician: MyTechnician; editable: boolean } | null;
  workOrders: WorkOrderSummary[];
  sites: Record<string, SiteResolved | null>;
  siteDispensers: Record<string, DispenserResolved[]>;
  dispenserDetails: Record<string, unknown>;
  syncedAt: string;
}

/** Drain queued writes first (so the pull reflects them), then refresh the
 * whole mirror. Quietly does nothing while offline. */
export async function syncAll(token: string | null): Promise<void> {
  if (!token) return;
  await drainOutbox(token);

  const pull = await rpc<SyncPull>('app_sync_pull', token);

  writeCache('workorders', pull.workOrders);
  // Always write, including null (#77): the technician record follows a
  // view-as switch, and clearing the view must also clear the mirror,
  // otherwise the previously viewed technician lingers on screen.
  writeCache('technician:me', pull.technician);

  const sites = Object.entries(pull.sites)
    .flatMap(([, s]) => (s ? [s] : []))
    .sort((a, b) => a.id.localeCompare(b.id));
  writeCache('sites', sites);

  for (const [siteId, site] of Object.entries(pull.sites)) {
    if (site) writeCache(`site:${siteId}`, site);
  }
  for (const [siteId, dispensers] of Object.entries(pull.siteDispensers)) {
    writeCache(`site-dispensers:${siteId}`, dispensers);
    for (const d of dispensers) writeCache(`dispenser:${d.id}`, d);
  }
  for (const [dispenserId, detail] of Object.entries(pull.dispenserDetails)) {
    writeCache(`dispenser-detail:${dispenserId}`, detail);
  }
  for (const wo of pull.workOrders) {
    writeCache(`workorder:${wo.id}`, {
      workOrder: wo,
      site: pull.sites[wo.siteId] ?? null,
      dispensers: pull.siteDispensers[wo.siteId] ?? [],
    });
  }
  writeCache('sync:last', pull.syncedAt);

  // Insights (#56) and the measures register (#70) ride the same sync so
  // both work offline — and both follow a view-as switch (#71).
  // Best-effort: a failure here must not fail the mirror sync.
  try {
    writeCache('insights', await rpc('app_insights', token));
  } catch {
    // keep the previous cached copy
  }
  try {
    writeCache('measures:my', await rpc('app_my_measures', token));
  } catch {
    // keep the previous cached copy
  }
}

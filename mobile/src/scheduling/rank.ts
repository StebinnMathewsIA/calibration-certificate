/**
 * Advisory next-job ranking (#107). The technician always chooses; this
 * only orders the list and SAYS WHY, because an unexplained order will
 * not be trusted.
 *
 * Owner rules (docs/PLATFORM-VISION.md):
 *  - urgency = complete-by date + SLA/importance class
 *  - OVERDUE ALWAYS WINS, regardless of distance
 *  - proximity is measured from the technician's LIVE location
 *  - v1 uses straight-line distance: no API, no cost, works offline.
 *    Real travel time is an upgrade behind this same interface.
 */
import type { WorkOrderRecord } from '../api/client';
import { parseWktPoint } from '../components/MiniMap';

export interface Ranked {
  wo: WorkOrderRecord;
  /** Lower sorts first, WITHIN a status group. */
  score: number;
  /** Status group this job sits in; the outer sort key. */
  stage: number;
  overdue: boolean;
  /** Kilometres from the technician, when both positions are known. */
  distanceKm: number | null;
  /** One line explaining the placement, shown on the card. */
  why: string;
}

/**
 * SLA urgency penalty, in the 0 (most urgent) to 2 (least) scale the
 * score below expects. OnKey's importance register carries its own
 * Weight where HIGHER means more urgent: SLA-Emergency 10, SLA-Urgent 7,
 * Other/Manual 5, SLA-Normal 3, UNKNOWN 0. Invert it onto our scale.
 *
 * Work orders with no importance yet (the current export does not carry
 * ImportanceCode) land on 1, the middle, so ranking falls back to
 * due date and distance rather than pretending to know.
 */
const importancePenalty = (weight: number | null | undefined): number =>
  weight == null ? 1 : Math.max(0, Math.min(2, (10 - weight) / 5));

export function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

const hoursUntil = (iso: string | null, now: Date): number | null =>
  iso ? (new Date(iso).getTime() - now.getTime()) / 3_600_000 : null;

function humanHours(h: number): string {
  const abs = Math.abs(h);
  if (abs < 1) return `${Math.round(abs * 60)} min`;
  if (abs < 48) return `${Math.round(abs)} h`;
  return `${Math.round(abs / 24)} days`;
}

/** Rank a technician's OPEN work orders. Work already signed off drops
 * out; started/paused work stays visible (it is what they are on). */
export function rankWorkOrders(
  workOrders: WorkOrderRecord[],
  here: { latitude: number; longitude: number } | null,
  now: Date = new Date(),
): Ranked[] {
  const ranked = workOrders.map((wo) => {
    const point = parseWktPoint(wo.gpsLocation ?? undefined);
    const distanceKm =
      here && point ? haversineKm(here, { latitude: point.lat, longitude: point.lon }) : null;
    const untilDue = hoursUntil(wo.completeBy ?? wo.requiredBy, now);
    const overdue = untilDue != null && untilDue < 0;
    const importance = importancePenalty(wo.importanceWeight);

    // Tier 0 = overdue and nothing outranks it. Within the tier, the most
    // overdue first, then the nearest.
    let score: number;
    if (overdue) {
      score = -1_000_000 + (untilDue ?? 0) * 10 + (distanceKm ?? 50) * 0.1;
    } else {
      // Hours until due dominate; the SLA class shifts a job up to a day
      // earlier or later; distance breaks near-ties (about 3 min/km).
      const due = untilDue ?? 24 * 30;
      score = due + importance * 12 + (distanceKm ?? 50) * 0.25;
    }

    const bits: string[] = [];
    if (overdue) bits.push(`overdue by ${humanHours(untilDue!)}`);
    else if (untilDue != null) bits.push(`due in ${humanHours(untilDue)}`);
    if (distanceKm != null) bits.push(`${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km away`);
    if (wo.estimatedDurationMinutes) bits.push(`about ${wo.estimatedDurationMinutes} min`);

    // OUR state outranks OnKey's when the technician has engaged with the
    // job. Sorting purely on OnKey status would bury the job they are
    // driving to among 400 other Allocated ones, which is the opposite of
    // useful. Untouched work keeps OnKey's lifecycle order underneath.
    const ours = wo.lifecycle?.state;
    const stage =
      ours === 'on_the_way' ? 1
      : ours === 'started' ? 2
      : ours === 'paused' ? 3
      : (wo.statusStage ?? 95);

    return { wo, score, stage, overdue, distanceKm, why: bits.join(' · ') };
  });

  // Status decides the order, urgency decides it inside a status. Owner
  // rule, 2026-08-05: the technician works down the list in lifecycle
  // order, Allocated first, so what planning has just given them is at
  // the top rather than buried under jobs they have already stopped.
  return ranked
    .filter((r) => r.wo.lifecycle?.state !== 'signed_off')
    .sort((a, b) => a.stage - b.stage || a.score - b.score);
}

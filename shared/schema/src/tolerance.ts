/**
 * Accuracy math for NRCS liquid-fuel-dispenser verification.
 *
 * The certificate reports, per delivery, the **EFD** (relative error of the
 * dispenser against the reference measure):
 *
 *     EFD = (VFD − VREF) / VREF × 100   [%]
 *
 * where VFD = volume indicated by the dispenser (LFD) and VREF = volume
 * indicated by the reference proving measure. A delivery passes when
 * |EFD| ≤ MPE.
 *
 * IMPORTANT: the MPE below is provisional. Confirm the exact NRCS / LM-IR
 * 117-2 maximum permissible error and the EFD sign convention with Prowalco's
 * quality manager before production use (see CLAUDE.md open questions).
 *
 * This module is mirrored in Python at backend/app/tolerance.py — keep the two
 * implementations consistent in behaviour. The backend recomputes every
 * delivery and rejects submissions whose client-computed EFD/outcome disagree.
 */

/** Maximum permissible error for a fuel-dispenser delivery, in percent.
 * PROVISIONAL — confirm with NRCS/QM. */
export const MPE_PERCENT = 0.5;

/** The delivery test points on the Metrologist Note, in report order. */
export const DELIVERY_POINTS = [
  'del1_max',
  'del2_max',
  'del3_max',
  'min_flow',
  'preset',
] as const;
export type DeliveryPoint = (typeof DELIVERY_POINTS)[number];

export const DELIVERY_POINT_LABELS: Record<DeliveryPoint, string> = {
  del1_max: 'Delivery 1 at max. achievable flow rate',
  del2_max: 'Delivery 2 at max. achievable flow rate',
  del3_max: 'Delivery 3 at max. achievable flow rate',
  min_flow: 'Delivery at minimum flow rate',
  preset: 'Preset delivery',
};

export interface EfdComputation {
  /** (VFD − VREF) / VREF × 100, rounded to 2 decimal places (%). */
  efdPercent: number;
  /** true when |EFD| ≤ MPE. */
  pass: boolean;
}

export function roundTo(value: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  // EPSILON nudge avoids 0.5-boundary floating point misrounds (e.g. 1.005)
  return Math.round((value + Number.EPSILON) * f) / f;
}

/**
 * Compute the EFD (%) and pass/fail for one delivery.
 * @param vfdMl  volume indicated by the dispenser (mL or L — units cancel)
 * @param vrefMl volume indicated by the reference measure (same unit as vfd)
 */
export function computeEfd(vfdMl: number, vrefMl: number): EfdComputation {
  if (vrefMl <= 0) {
    throw new Error('Reference volume (VREF) must be > 0');
  }
  const efdPercent = roundTo(((vfdMl - vrefMl) / vrefMl) * 100, 2);
  return {
    efdPercent,
    pass: Math.abs(efdPercent) <= MPE_PERCENT,
  };
}

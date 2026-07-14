/**
 * Tolerance classes and error math for fuel dispenser calibration.
 *
 * IMPORTANT: the MPE values below are provisional. Confirm the exact NRCS /
 * OIML R117 accuracy class per dispenser type with Prowalco's quality manager
 * before production use (see CLAUDE.md "Open questions" #1).
 *
 * This module is mirrored in Python at backend/app/tolerance.py — keep the
 * two implementations byte-for-byte consistent in behaviour. The backend
 * recomputes every row and rejects submissions whose client-computed values
 * disagree.
 */

export interface ToleranceClass {
  id: string;
  name: string;
  /** Maximum permissible error as a percentage of the measured volume. */
  mpePercent: number;
  reference: string;
}

export const TOLERANCE_CLASSES: Record<string, ToleranceClass> = {
  oiml_r117_class_0_5: {
    id: 'oiml_r117_class_0_5',
    name: 'OIML R117 accuracy class 0.5 (fuel dispenser)',
    mpePercent: 0.5,
    reference: 'OIML R117-1 — PROVISIONAL, confirm with NRCS/QM',
  },
  oiml_r117_class_0_3: {
    id: 'oiml_r117_class_0_3',
    name: 'OIML R117 accuracy class 0.3',
    mpePercent: 0.3,
    reference: 'OIML R117-1 — PROVISIONAL, confirm with NRCS/QM',
  },
};

export const DEFAULT_TOLERANCE_CLASS_ID = 'oiml_r117_class_0_5';

/**
 * Uncertainty statement from the lab uncertainty budget. Placeholder until
 * Prowalco's uncertainty budget is finalised; the value is configuration,
 * not measurement data.
 */
export const UNCERTAINTY_STATEMENT =
  'Expanded uncertainty of measurement: ±0.15 % of reading, coverage factor k=2 ' +
  '(approx. 95 % confidence). PROVISIONAL — pending Prowalco uncertainty budget.';

export interface RowComputation {
  /** (indicated − measured) × 1000, rounded to 1 decimal place (mL). */
  errorMl: number;
  /** (indicated − measured) / measured × 100, rounded to 3 decimal places (%). */
  errorPercent: number;
  pass: boolean;
}

export function roundTo(value: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  // EPSILON nudge avoids 0.5-boundary floating point misrounds (e.g. 1.005)
  return Math.round((value + Number.EPSILON) * f) / f;
}

export function computeRow(
  indicatedVolumeL: number,
  measuredVolumeL: number,
  toleranceClassId: string = DEFAULT_TOLERANCE_CLASS_ID,
): RowComputation {
  const tol = TOLERANCE_CLASSES[toleranceClassId];
  if (!tol) {
    throw new Error(`Unknown tolerance class: ${toleranceClassId}`);
  }
  if (measuredVolumeL <= 0) {
    throw new Error('Measured volume must be > 0');
  }
  const errorL = indicatedVolumeL - measuredVolumeL;
  const errorMl = roundTo(errorL * 1000, 1);
  const errorPercent = roundTo((errorL / measuredVolumeL) * 100, 3);
  return {
    errorMl,
    errorPercent,
    pass: Math.abs(errorPercent) <= tol.mpePercent,
  };
}

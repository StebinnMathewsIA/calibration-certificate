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
export declare const MPE_PERCENT = 0.5;
/** The delivery test points on the Metrologist Note, in report order. */
export declare const DELIVERY_POINTS: readonly ["del1_max", "del2_max", "del3_max", "min_flow", "preset"];
export type DeliveryPoint = (typeof DELIVERY_POINTS)[number];
export declare const DELIVERY_POINT_LABELS: Record<DeliveryPoint, string>;
export interface EfdComputation {
    /** (VFD − VREF) / VREF × 100, rounded to 2 decimal places (%). */
    efdPercent: number;
    /** true when |EFD| ≤ MPE. */
    pass: boolean;
}
export declare function roundTo(value: number, decimals: number): number;
/**
 * Compute the EFD (%) and pass/fail for one delivery.
 * @param vfdMl  volume indicated by the dispenser (mL or L — units cancel)
 * @param vrefMl volume indicated by the reference measure (same unit as vfd)
 */
export declare function computeEfd(vfdMl: number, vrefMl: number): EfdComputation;

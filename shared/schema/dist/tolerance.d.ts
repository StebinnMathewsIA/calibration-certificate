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
 * MPE CONFIRMED (owner, 2026-07-31): SANS TEST PROC02 rev 14, Table 1
 * (LM-IR 117-1 maximum permissible error), accuracy class 0.5, Line A =
 * 0.5 % — the cell highlighted as applicable in Prowalco's controlled
 * procedure. The nozzle burst limit is separate and absolute: 50 ml.
 *
 * This module is mirrored in Python at backend/app/tolerance.py — keep the two
 * implementations consistent in behaviour. The backend recomputes every
 * delivery and rejects submissions whose client-computed EFD/outcome disagree.
 */
/** Maximum permissible error for a fuel-dispenser delivery, in percent:
 * accuracy class 0.5, Line A of LM-IR 117-1 Table 1 (confirmed, #91). */
export declare const MPE_PERCENT = 0.5;
/** Nozzle burst (hose dilation) limit, ml — absolute, not a percentage
 * (SANS TEST PROC02 4.3.2.5). */
export declare const NOZZLE_BURST_LIMIT_ML = 50;
/** The delivery test points on the Metrologist Note, in report order.
 * min_flow_20l is the slow 20 L test added by SANS TEST PROC02 rev 15
 * (4.3.2, #89): an accuracy delivery at minimum flow into the 20 L
 * measure, run after the three max-flow deliveries. */
export declare const DELIVERY_POINTS: readonly ["del1_max", "del2_max", "del3_max", "min_flow_20l", "min_flow", "preset"];
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

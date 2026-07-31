"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DELIVERY_POINT_LABELS = exports.DELIVERY_POINTS = exports.NOZZLE_BURST_LIMIT_ML = exports.MPE_PERCENT = void 0;
exports.roundTo = roundTo;
exports.computeEfd = computeEfd;
/** Maximum permissible error for a fuel-dispenser delivery, in percent:
 * accuracy class 0.5, Line A of LM-IR 117-1 Table 1 (confirmed, #91). */
exports.MPE_PERCENT = 0.5;
/** Nozzle burst (hose dilation) limit, ml — absolute, not a percentage
 * (SANS TEST PROC02 4.3.2.5). */
exports.NOZZLE_BURST_LIMIT_ML = 50;
/** The delivery test points on the Metrologist Note, in report order.
 * min_flow_20l is the slow 20 L test added by SANS TEST PROC02 rev 15
 * (4.3.2, #89): an accuracy delivery at minimum flow into the 20 L
 * measure, run after the three max-flow deliveries. */
exports.DELIVERY_POINTS = [
    'del1_max',
    'del2_max',
    'del3_max',
    'min_flow_20l',
    'min_flow',
    'preset',
];
exports.DELIVERY_POINT_LABELS = {
    del1_max: 'Delivery 1 at max. achievable flow rate',
    del2_max: 'Delivery 2 at max. achievable flow rate',
    del3_max: 'Delivery 3 at max. achievable flow rate',
    min_flow_20l: 'Delivery at minimum flow rate (20 L)',
    min_flow: 'Delivery at minimum flow rate (5 L)',
    preset: 'Preset delivery',
};
function roundTo(value, decimals) {
    const f = Math.pow(10, decimals);
    // EPSILON nudge avoids 0.5-boundary floating point misrounds (e.g. 1.005)
    return Math.round((value + Number.EPSILON) * f) / f;
}
/**
 * Compute the EFD (%) and pass/fail for one delivery.
 * @param vfdMl  volume indicated by the dispenser (mL or L — units cancel)
 * @param vrefMl volume indicated by the reference measure (same unit as vfd)
 */
function computeEfd(vfdMl, vrefMl) {
    if (vrefMl <= 0) {
        throw new Error('Reference volume (VREF) must be > 0');
    }
    const efdPercent = roundTo(((vfdMl - vrefMl) / vrefMl) * 100, 2);
    return {
        efdPercent,
        pass: Math.abs(efdPercent) <= exports.MPE_PERCENT,
    };
}

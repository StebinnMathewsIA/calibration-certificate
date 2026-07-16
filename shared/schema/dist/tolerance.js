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
 * IMPORTANT: the MPE below is provisional. Confirm the exact NRCS / LM-IR
 * 117-2 maximum permissible error and the EFD sign convention with Prowalco's
 * quality manager before production use (see CLAUDE.md open questions).
 *
 * This module is mirrored in Python at backend/app/tolerance.py — keep the two
 * implementations consistent in behaviour. The backend recomputes every
 * delivery and rejects submissions whose client-computed EFD/outcome disagree.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DELIVERY_POINT_LABELS = exports.DELIVERY_POINTS = exports.MPE_PERCENT = void 0;
exports.roundTo = roundTo;
exports.computeEfd = computeEfd;
/** Maximum permissible error for a fuel-dispenser delivery, in percent.
 * PROVISIONAL — confirm with NRCS/QM. */
exports.MPE_PERCENT = 0.5;
/** The delivery test points on the Metrologist Note, in report order. */
exports.DELIVERY_POINTS = [
    'del1_max',
    'del2_max',
    'del3_max',
    'min_flow',
    'preset',
];
exports.DELIVERY_POINT_LABELS = {
    del1_max: 'Delivery 1 at max. achievable flow rate',
    del2_max: 'Delivery 2 at max. achievable flow rate',
    del3_max: 'Delivery 3 at max. achievable flow rate',
    min_flow: 'Delivery at minimum flow rate',
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

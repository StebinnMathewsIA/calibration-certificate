"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateReadyToSign = validateReadyToSign;
const verification_1 = require("./verification");
const tolerance_1 = require("./tolerance");
/** Tolerance for comparing the client-computed EFD against a recompute. */
const EPSILON_PCT = 0.005001; // efdPercent rounded to 2 dp
function checkDelivery(d, label, reasons) {
    if (d.vrefMl <= 0) {
        reasons.push(`${label}: VREF must be greater than 0`);
        return;
    }
    const expected = (0, tolerance_1.computeEfd)(d.vfdMl, d.vrefMl);
    if (Math.abs(expected.efdPercent - d.efdPercent) > EPSILON_PCT) {
        reasons.push(`${label}: EFD (%) does not match recomputed value`);
    }
    if (expected.pass !== d.pass) {
        reasons.push(`${label}: pass/fail flag does not match recomputed value`);
    }
}
function checkHose(hose, label, reasons) {
    hose.deliveries.forEach((d, i) => checkDelivery(d, `${label}.deliveries[${i}] (${d.point})`, reasons));
    // Outcome must be consistent with the evidence: a "certified" hose cannot
    // have any failing delivery or any failed checklist item.
    const anyDeliveryFailed = hose.deliveries.some((d) => !d.pass);
    const anyChecklistFailed = Object.values(hose.checklist).some((v) => v === 'fail');
    if (hose.outcome === 'certified' && (anyDeliveryFailed || anyChecklistFailed)) {
        reasons.push(`${label}: outcome is "certified" but a delivery or checklist item failed`);
    }
    if (hose.outcome === 'rejected' && !anyDeliveryFailed && !anyChecklistFailed) {
        reasons.push(`${label}: outcome is "rejected" but no delivery or checklist item failed`);
    }
}
function validateReadyToSign(candidate, opts = {}) {
    const reasons = [];
    const parsed = verification_1.verificationSchema.safeParse(candidate);
    if (!parsed.success) {
        for (const issue of parsed.error.issues) {
            reasons.push(`${issue.path.join('.') || '(form)'}: ${issue.message}`);
        }
        return { ready: false, reasons };
    }
    const v = parsed.data;
    // Declaration must be ticked
    if (!v.signOff.declarationAccepted) {
        reasons.push('signOff.declarationAccepted: the declaration must be accepted before signing');
    }
    // VO pliers number is required for the accountable signature
    if (!v.signOff.vo.pliersNumber) {
        reasons.push('signOff.vo.pliersNumber: the VO pliers number is required');
    }
    // Reference measures must be in date on the verification date (and today)
    const verDate = v.verificationDate;
    const today = (opts.now ?? new Date()).toISOString().slice(0, 10);
    for (const m of v.referenceMeasures) {
        if (m.expiryDate < verDate) {
            reasons.push(`referenceMeasures: ${m.size} measure (${m.serialNumber}) expired ${m.expiryDate}, ` +
                `before the verification date ${verDate}`);
        }
        else if (m.expiryDate < today) {
            reasons.push(`referenceMeasures: ${m.size} measure (${m.serialNumber}) expired ${m.expiryDate}`);
        }
    }
    // Verification date must not be in the future
    if (verDate > today) {
        reasons.push('verificationDate: verification date is in the future');
    }
    // A rejected hose requires a rejection certificate number
    const anyRejected = v.hoses.some((h) => h.outcome === 'rejected');
    if (anyRejected && !v.signOff.rejectionCertNumber) {
        reasons.push('signOff.rejectionCertNumber: required because at least one hose was rejected');
    }
    // Recompute and verify every hose's deliveries + outcome
    v.hoses.forEach((hose, i) => checkHose(hose, `hoses[${i}]`, reasons));
    return { ready: reasons.length === 0, reasons };
}

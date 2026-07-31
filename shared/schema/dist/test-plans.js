"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TEST_PLAN_ID = exports.TEST_PLANS = exports.HV_QMAX_THRESHOLD_LPM = void 0;
exports.testPlanFor = testPlanFor;
exports.deriveDesignation = deriveDesignation;
exports.planForDesignation = planForDesignation;
/**
 * Test-plan registry (#92): the delivery plan, required measures and timing
 * rules for a verification are DATA, selected by the dispenser's designation,
 * never chosen by the VO. One certificate document type, many plans.
 *
 * Plans are versioned by id: executed verifications record the plan id they
 * ran under, and a plan is NEVER edited once certificates reference it — a
 * changed procedure gets a new id (e.g. lfd-std-v2).
 *
 * The Python backend consumes this registry via the generated
 * json/test-plans.json (scripts/export-json-schema.ts) — no hand mirror.
 */
const tolerance_1 = require("./tolerance");
/** An LFD is high flow rate when approved above this Qmax (PROC02 defs). */
exports.HV_QMAX_THRESHOLD_LPM = 100;
exports.TEST_PLANS = {
    'lfd-std-v1': {
        id: 'lfd-std-v1',
        designation: 'std',
        requiredMeasures: ['20L', '5L'],
        zeroCheckSeconds: 5,
        flowRateMethod: 'direct',
        mpePercent: tolerance_1.MPE_PERCENT,
        deliveries: [
            { point: 'del1_max', nominalMl: 20000, label: 'Delivery 1 at max. achievable flow rate', pdfLabel: 'Del 1 at max. achievable flow rate' },
            { point: 'del2_max', nominalMl: 20000, label: 'Delivery 2 at max. achievable flow rate', pdfLabel: 'Del 2 at max. achievable flow rate' },
            { point: 'del3_max', nominalMl: 20000, label: 'Delivery 3 at max. achievable flow rate', pdfLabel: 'Del 3 at max. achievable flow rate' },
            { point: 'min_flow_20l', nominalMl: 20000, label: 'Delivery at minimum flow rate (20 L)', pdfLabel: 'Delivery at minimum flow rate (20 L)' },
            { point: 'min_flow', nominalMl: 5000, label: 'Delivery at minimum flow rate (5 L)', pdfLabel: 'Delivery at minimum flow rate (5 L)' },
            { point: 'preset', nominalMl: 5000, label: 'Preset delivery', pdfLabel: 'Preset delivery' },
        ],
    },
    'lfd-hv-v1': {
        id: 'lfd-hv-v1',
        designation: 'hv',
        requiredMeasures: ['200L'],
        zeroCheckSeconds: 60,
        flowRateMethod: 'timed5s_x12',
        mpePercent: tolerance_1.MPE_PERCENT,
        deliveries: [
            { point: 'del1_max', nominalMl: 200000, label: 'Delivery 1 at max. achievable flow rate (200 L)', pdfLabel: 'Del 1 at max. achievable flow rate (200 L)' },
            { point: 'del2_max', nominalMl: 200000, label: 'Delivery 2 at max. achievable flow rate (200 L)', pdfLabel: 'Del 2 at max. achievable flow rate (200 L)' },
            { point: 'del3_max', nominalMl: 200000, label: 'Delivery 3 at max. achievable flow rate (200 L)', pdfLabel: 'Del 3 at max. achievable flow rate (200 L)' },
            { point: 'min_flow', nominalMl: 200000, label: 'Delivery at minimum flow rate (200 L)', pdfLabel: 'Delivery at minimum flow rate (200 L)' },
            { point: 'preset', nominalMl: 200000, label: 'Preset delivery (200 L)', pdfLabel: 'Preset delivery (200 L)' },
        ],
    },
};
exports.DEFAULT_TEST_PLAN_ID = 'lfd-std-v1';
/** The plan a verification ran under. A missing field means the payload
 * predates the registry: always lfd-std-v1, forever. */
function testPlanFor(v) {
    return exports.TEST_PLANS[v.testPlan ?? exports.DEFAULT_TEST_PLAN_ID] ?? exports.TEST_PLANS[exports.DEFAULT_TEST_PLAN_ID];
}
/** Derived designation from the data plate; identity confirms explicitly. */
function deriveDesignation(qMaxLpm) {
    if (qMaxLpm == null || qMaxLpm <= 0)
        return null;
    return qMaxLpm > exports.HV_QMAX_THRESHOLD_LPM ? 'hv' : 'std';
}
function planForDesignation(d) {
    return d === 'hv' ? exports.TEST_PLANS['lfd-hv-v1'] : exports.TEST_PLANS['lfd-std-v1'];
}

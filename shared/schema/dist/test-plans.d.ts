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
import { type DeliveryPoint } from './tolerance';
/** An LFD is high flow rate when approved above this Qmax (PROC02 defs). */
export declare const HV_QMAX_THRESHOLD_LPM = 100;
export type Designation = 'std' | 'hv';
export type TestPlanId = 'lfd-std-v1' | 'lfd-hv-v1';
export interface TestPlanDelivery {
    point: DeliveryPoint;
    /** Fixed VFD nominal for the point, ml. */
    nominalMl: number;
    /** Results-screen label. */
    label: string;
    /** Metrologist-grid row label — for lfd-std-v1 these are byte-identical
     * to the pre-registry strings so legacy certificates re-render unchanged. */
    pdfLabel: string;
}
export interface TestPlan {
    id: TestPlanId;
    designation: Designation;
    /** Measure sizes that must be certified and in date before starting. */
    requiredMeasures: ('200L' | '20L' | '5L')[];
    deliveries: TestPlanDelivery[];
    /** Display must sit at zero this long before a delivery (PROC02). */
    zeroCheckSeconds: number;
    /** How the max flow rate is obtained: read directly, or a 5-second timed
     * delivery multiplied by 12 (PROC02 4.5.1, high flow). */
    flowRateMethod: 'direct' | 'timed5s_x12';
    mpePercent: number;
}
export declare const TEST_PLANS: Record<TestPlanId, TestPlan>;
export declare const DEFAULT_TEST_PLAN_ID: TestPlanId;
/** The plan a verification ran under. A missing field means the payload
 * predates the registry: always lfd-std-v1, forever. */
export declare function testPlanFor(v: {
    testPlan?: string | null;
}): TestPlan;
/** Derived designation from the data plate; identity confirms explicitly. */
export declare function deriveDesignation(qMaxLpm: number | null | undefined): Designation | null;
export declare function planForDesignation(d: Designation): TestPlan;

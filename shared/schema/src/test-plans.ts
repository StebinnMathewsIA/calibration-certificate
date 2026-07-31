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
import { MPE_PERCENT, type DeliveryPoint } from './tolerance';

/** An LFD is high flow rate when approved above this Qmax (PROC02 defs). */
export const HV_QMAX_THRESHOLD_LPM = 100;

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

export const TEST_PLANS: Record<TestPlanId, TestPlan> = {
  'lfd-std-v1': {
    id: 'lfd-std-v1',
    designation: 'std',
    requiredMeasures: ['20L', '5L'],
    zeroCheckSeconds: 5,
    flowRateMethod: 'direct',
    mpePercent: MPE_PERCENT,
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
    mpePercent: MPE_PERCENT,
    deliveries: [
      { point: 'del1_max', nominalMl: 200000, label: 'Delivery 1 at max. achievable flow rate (200 L)', pdfLabel: 'Del 1 at max. achievable flow rate (200 L)' },
      { point: 'del2_max', nominalMl: 200000, label: 'Delivery 2 at max. achievable flow rate (200 L)', pdfLabel: 'Del 2 at max. achievable flow rate (200 L)' },
      { point: 'del3_max', nominalMl: 200000, label: 'Delivery 3 at max. achievable flow rate (200 L)', pdfLabel: 'Del 3 at max. achievable flow rate (200 L)' },
      { point: 'min_flow', nominalMl: 200000, label: 'Delivery at minimum flow rate (200 L)', pdfLabel: 'Delivery at minimum flow rate (200 L)' },
      { point: 'preset', nominalMl: 200000, label: 'Preset delivery (200 L)', pdfLabel: 'Preset delivery (200 L)' },
    ],
  },
};

export const DEFAULT_TEST_PLAN_ID: TestPlanId = 'lfd-std-v1';

/** The plan a verification ran under. A missing field means the payload
 * predates the registry: always lfd-std-v1, forever. */
export function testPlanFor(v: { testPlan?: string | null }): TestPlan {
  return TEST_PLANS[(v.testPlan as TestPlanId) ?? DEFAULT_TEST_PLAN_ID] ?? TEST_PLANS[DEFAULT_TEST_PLAN_ID];
}

/** Derived designation from the data plate; identity confirms explicitly. */
export function deriveDesignation(qMaxLpm: number | null | undefined): Designation | null {
  if (qMaxLpm == null || qMaxLpm <= 0) return null;
  return qMaxLpm > HV_QMAX_THRESHOLD_LPM ? 'hv' : 'std';
}

export function planForDesignation(d: Designation): TestPlan {
  return d === 'hv' ? TEST_PLANS['lfd-hv-v1'] : TEST_PLANS['lfd-std-v1'];
}

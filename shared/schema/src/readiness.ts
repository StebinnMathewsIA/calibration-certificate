import { CalibrationForm, calibrationFormSchema, ResultRow } from './calibration';
import { computeRow, TOLERANCE_CLASSES } from './tolerance';

/**
 * Sign-readiness checks (DRAFT → READY_TO_SIGN gate). The mobile app shows
 * `reasons` next to the disabled Sign button; the backend runs the same
 * checks (Python mirror) before signing so a compromised client cannot get
 * a non-conforming certificate signed.
 */

export interface ReadinessResult {
  ready: boolean;
  reasons: string[];
}

/** Tolerance for comparing client-computed values against a recompute. */
const EPSILON_ML = 0.05001; // errorMl rounded to 1 dp
const EPSILON_PCT = 0.0005001; // errorPercent rounded to 3 dp

function checkRow(row: ResultRow, label: string, reasons: string[]): void {
  if (!(row.toleranceClassId in TOLERANCE_CLASSES)) {
    reasons.push(`${label}: unknown tolerance class "${row.toleranceClassId}"`);
    return;
  }
  const expected = computeRow(row.indicatedVolumeL, row.measuredVolumeL, row.toleranceClassId);
  if (Math.abs(expected.errorMl - row.errorMl) > EPSILON_ML) {
    reasons.push(`${label}: error (mL) does not match recomputed value`);
  }
  if (Math.abs(expected.errorPercent - row.errorPercent) > EPSILON_PCT) {
    reasons.push(`${label}: error (%) does not match recomputed value`);
  }
  if (expected.pass !== row.pass) {
    reasons.push(`${label}: pass/fail flag does not match recomputed value`);
  }
  // Sanity limits — physically implausible entries are almost always typos.
  if (Math.abs(row.indicatedVolumeL - row.nominalDeliveryL) > row.nominalDeliveryL * 0.5) {
    reasons.push(`${label}: indicated volume differs from nominal by more than 50%`);
  }
}

export function validateReadyToSign(
  candidate: unknown,
  opts: { now?: Date } = {},
): ReadinessResult {
  const reasons: string[] = [];

  const parsed = calibrationFormSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      reasons.push(`${issue.path.join('.') || '(form)'}: ${issue.message}`);
    }
    return { ready: false, reasons };
  }
  const form: CalibrationForm = parsed.data;

  // Declaration must be ticked
  if (!form.signOff.declarationAccepted) {
    reasons.push('signOff.declarationAccepted: the declaration must be accepted before signing');
  }

  // Reference standards must be in date on the calibration date (and today)
  const calDate = form.job.calibrationDate;
  const today = (opts.now ?? new Date()).toISOString().slice(0, 10);
  for (const std of form.referenceStandards) {
    if (std.calibrationDueDate < calDate) {
      reasons.push(
        `referenceStandards: "${std.description}" (${std.serialNumber}) calibration expired ` +
          `${std.calibrationDueDate}, before the calibration date ${calDate}`,
      );
    } else if (std.calibrationDueDate < today) {
      reasons.push(
        `referenceStandards: "${std.description}" (${std.serialNumber}) calibration expired ` +
          `${std.calibrationDueDate}`,
      );
    }
  }

  // Calibration date must not be in the future
  if (calDate > today) {
    reasons.push('job.calibrationDate: calibration date is in the future');
  }

  // Recompute and verify every result row
  form.results.asFound.forEach((row, i) => checkRow(row, `results.asFound[${i}]`, reasons));
  (form.results.asLeft ?? []).forEach((row, i) => checkRow(row, `results.asLeft[${i}]`, reasons));

  return { ready: reasons.length === 0, reasons };
}

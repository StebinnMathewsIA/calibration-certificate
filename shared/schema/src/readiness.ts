import {
  Delivery,
  HoseResult,
  Verification,
  verificationSchema,
} from './verification';
import { computeEfd } from './tolerance';

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

/** Tolerance for comparing the client-computed EFD against a recompute. */
const EPSILON_PCT = 0.005001; // efdPercent rounded to 2 dp

function checkDelivery(d: Delivery, label: string, reasons: string[]): void {
  if (d.vrefMl <= 0) {
    reasons.push(`${label}: VREF must be greater than 0`);
    return;
  }
  const expected = computeEfd(d.vfdMl, d.vrefMl);
  if (Math.abs(expected.efdPercent - d.efdPercent) > EPSILON_PCT) {
    reasons.push(`${label}: EFD (%) does not match recomputed value`);
  }
  if (expected.pass !== d.pass) {
    reasons.push(`${label}: pass/fail flag does not match recomputed value`);
  }
}

function checkHose(hose: HoseResult, label: string, reasons: string[]): void {
  hose.deliveries.forEach((d, i) =>
    checkDelivery(d, `${label}.deliveries[${i}] (${d.point})`, reasons),
  );

  // Outcome must be consistent with the evidence: a "certified" hose cannot
  // have any failing delivery or any failed checklist item.
  const anyDeliveryFailed = hose.deliveries.some((d) => !d.pass);
  const anyChecklistFailed = Object.values(hose.checklist).some((v) => v === 'fail');
  if (hose.outcome === 'certified' && (anyDeliveryFailed || anyChecklistFailed)) {
    reasons.push(
      `${label}: outcome is "certified" but a delivery or checklist item failed`,
    );
  }
  if (hose.outcome === 'rejected' && !anyDeliveryFailed && !anyChecklistFailed) {
    reasons.push(
      `${label}: outcome is "rejected" but no delivery or checklist item failed`,
    );
  }
}

export function validateReadyToSign(
  candidate: unknown,
  opts: { now?: Date } = {},
): ReadinessResult {
  const reasons: string[] = [];

  const parsed = verificationSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      reasons.push(`${issue.path.join('.') || '(form)'}: ${issue.message}`);
    }
    return { ready: false, reasons };
  }
  const v: Verification = parsed.data;

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
      reasons.push(
        `referenceMeasures: ${m.size} measure (${m.serialNumber}) expired ${m.expiryDate}, ` +
          `before the verification date ${verDate}`,
      );
    } else if (m.expiryDate < today) {
      reasons.push(
        `referenceMeasures: ${m.size} measure (${m.serialNumber}) expired ${m.expiryDate}`,
      );
    }
  }

  // Verification date must not be in the future
  if (verDate > today) {
    reasons.push('verificationDate: verification date is in the future');
  }

  // A rejected hose requires a rejection certificate number
  const anyRejected = v.hoses.some((h) => h.outcome === 'rejected');
  if (anyRejected && !v.signOff.rejectionCertNumber) {
    reasons.push(
      'signOff.rejectionCertNumber: required because at least one hose was rejected',
    );
  }

  // Recompute and verify every hose's deliveries + outcome
  v.hoses.forEach((hose, i) => checkHose(hose, `hoses[${i}]`, reasons));

  return { ready: reasons.length === 0, reasons };
}

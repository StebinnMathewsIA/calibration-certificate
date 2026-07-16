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
export declare function validateReadyToSign(candidate: unknown, opts?: {
    now?: Date;
}): ReadinessResult;

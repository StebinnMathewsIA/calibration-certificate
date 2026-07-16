"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATE_TRANSITIONS = exports.CERTIFICATE_STATES = exports.signResponseSchema = exports.signSubmissionSchema = exports.intentToSignSchema = exports.gpsFixSchema = void 0;
exports.canTransition = canTransition;
const zod_1 = require("zod");
const verification_1 = require("./verification");
/**
 * Sign-queue / signing API envelope shared by the mobile queue and the
 * backend /certificates/sign endpoint.
 */
const sha256Hex = zod_1.z.string().regex(/^[0-9a-f]{64}$/);
const uuid = zod_1.z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const isoDateTime = zod_1.z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
exports.gpsFixSchema = zod_1.z.object({
    latitude: zod_1.z.number().gte(-90).lte(90),
    longitude: zod_1.z.number().gte(-180).lte(180),
    accuracyM: zod_1.z.number().nonnegative(),
    /** POPIA: GPS is only captured with explicit consent. */
    consentGiven: zod_1.z.literal(true),
});
exports.intentToSignSchema = zod_1.z.object({
    /** Device clock at the moment the technician passed the biometric prompt. */
    deviceTimestamp: isoDateTime,
    deviceId: zod_1.z.string().min(1).max(128),
    gps: exports.gpsFixSchema.optional(),
});
exports.signSubmissionSchema = zod_1.z.object({
    /** Client-generated UUID — retries never double-sign or double-issue. */
    idempotencyKey: uuid,
    verification: verification_1.verificationSchema,
    /** SHA-256 of the unsigned PDF bytes, computed on-device. */
    pdfSha256: sha256Hex,
    /** Unsigned PDF rendered on-device by expo-print, base64-encoded. */
    pdfBase64: zod_1.z.string().min(1),
    intentToSign: exports.intentToSignSchema,
});
exports.signResponseSchema = zod_1.z.object({
    certificateNumber: zod_1.z.string(),
    status: zod_1.z.literal('issued'),
    signedPdfBase64: zod_1.z.string(),
    signedPdfSha256: sha256Hex,
    signatureId: zod_1.z.string(),
    /** Cryptographic signing time from the RFC 3161 TSA (or server clock in dev). */
    signedAt: isoDateTime,
    auditId: zod_1.z.string(),
});
/** Sign-queue state machine (persisted in expo-sqlite; see CLAUDE.md). */
exports.CERTIFICATE_STATES = [
    'DRAFT',
    'READY_TO_SIGN',
    'QUEUED_FOR_SIGNING',
    'UPLOADING',
    'SIGNED',
    'SYNCED',
];
exports.STATE_TRANSITIONS = {
    DRAFT: ['READY_TO_SIGN'],
    READY_TO_SIGN: ['DRAFT', 'QUEUED_FOR_SIGNING'], // back to DRAFT on any edit
    QUEUED_FOR_SIGNING: ['UPLOADING'],
    UPLOADING: ['QUEUED_FOR_SIGNING', 'SIGNED'], // back to queue on failure
    SIGNED: ['SYNCED'],
    SYNCED: [],
};
function canTransition(from, to) {
    return exports.STATE_TRANSITIONS[from].includes(to);
}

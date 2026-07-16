"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MANAGER_NOTIFY_VERDICTS = exports.analysisResponseSchema = exports.analysisResultSchema = exports.analysisVerdictSchema = void 0;
const zod_1 = require("zod");
/**
 * Claude calibration-analysis verdict contract, shared by the backend
 * (structured output schema for the Messages API) and the mobile verdict
 * card. The verdict is ADVISORY — the human signatory remains responsible.
 */
exports.analysisVerdictSchema = zod_1.z.enum(['pass', 'marginal', 'fail', 'data_anomaly']);
exports.analysisResultSchema = zod_1.z.object({
    verdict: exports.analysisVerdictSchema,
    summary: zod_1.z.string().min(1),
    concerns: zod_1.z.array(zod_1.z.string()),
    recommendations: zod_1.z.array(zod_1.z.string()),
});
exports.analysisResponseSchema = zod_1.z.object({
    result: exports.analysisResultSchema,
    /** Model + prompt version are logged in the audit trail per certificate. */
    model: zod_1.z.string(),
    promptVersion: zod_1.z.string(),
    analyzedAt: zod_1.z.string(),
});
/** Verdicts that trigger a manager notification (push/email). */
exports.MANAGER_NOTIFY_VERDICTS = ['marginal', 'fail', 'data_anomaly'];

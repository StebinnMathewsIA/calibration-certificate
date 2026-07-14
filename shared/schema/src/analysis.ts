import { z } from 'zod';

/**
 * Claude calibration-analysis verdict contract, shared by the backend
 * (structured output schema for the Messages API) and the mobile verdict
 * card. The verdict is ADVISORY — the human signatory remains responsible.
 */

export const analysisVerdictSchema = z.enum(['pass', 'marginal', 'fail', 'data_anomaly']);

export const analysisResultSchema = z.object({
  verdict: analysisVerdictSchema,
  summary: z.string().min(1),
  concerns: z.array(z.string()),
  recommendations: z.array(z.string()),
});

export const analysisResponseSchema = z.object({
  result: analysisResultSchema,
  /** Model + prompt version are logged in the audit trail per certificate. */
  model: z.string(),
  promptVersion: z.string(),
  analyzedAt: z.string(),
});

export type AnalysisVerdict = z.infer<typeof analysisVerdictSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;

/** Verdicts that trigger a manager notification (push/email). */
export const MANAGER_NOTIFY_VERDICTS: AnalysisVerdict[] = ['marginal', 'fail', 'data_anomaly'];

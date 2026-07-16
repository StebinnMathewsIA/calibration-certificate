import { z } from 'zod';
/**
 * Claude calibration-analysis verdict contract, shared by the backend
 * (structured output schema for the Messages API) and the mobile verdict
 * card. The verdict is ADVISORY — the human signatory remains responsible.
 */
export declare const analysisVerdictSchema: z.ZodEnum<["pass", "marginal", "fail", "data_anomaly"]>;
export declare const analysisResultSchema: z.ZodObject<{
    verdict: z.ZodEnum<["pass", "marginal", "fail", "data_anomaly"]>;
    summary: z.ZodString;
    concerns: z.ZodArray<z.ZodString, "many">;
    recommendations: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    verdict: "pass" | "marginal" | "fail" | "data_anomaly";
    summary: string;
    concerns: string[];
    recommendations: string[];
}, {
    verdict: "pass" | "marginal" | "fail" | "data_anomaly";
    summary: string;
    concerns: string[];
    recommendations: string[];
}>;
export declare const analysisResponseSchema: z.ZodObject<{
    result: z.ZodObject<{
        verdict: z.ZodEnum<["pass", "marginal", "fail", "data_anomaly"]>;
        summary: z.ZodString;
        concerns: z.ZodArray<z.ZodString, "many">;
        recommendations: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        verdict: "pass" | "marginal" | "fail" | "data_anomaly";
        summary: string;
        concerns: string[];
        recommendations: string[];
    }, {
        verdict: "pass" | "marginal" | "fail" | "data_anomaly";
        summary: string;
        concerns: string[];
        recommendations: string[];
    }>;
    /** Model + prompt version are logged in the audit trail per certificate. */
    model: z.ZodString;
    promptVersion: z.ZodString;
    analyzedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    result: {
        verdict: "pass" | "marginal" | "fail" | "data_anomaly";
        summary: string;
        concerns: string[];
        recommendations: string[];
    };
    model: string;
    promptVersion: string;
    analyzedAt: string;
}, {
    result: {
        verdict: "pass" | "marginal" | "fail" | "data_anomaly";
        summary: string;
        concerns: string[];
        recommendations: string[];
    };
    model: string;
    promptVersion: string;
    analyzedAt: string;
}>;
export type AnalysisVerdict = z.infer<typeof analysisVerdictSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;
/** Verdicts that trigger a manager notification (push/email). */
export declare const MANAGER_NOTIFY_VERDICTS: AnalysisVerdict[];

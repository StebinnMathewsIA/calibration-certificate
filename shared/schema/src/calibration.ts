import { z } from 'zod';

/**
 * Calibration form schema — the single source of truth shared by the mobile
 * app (react-hook-form validation) and the backend (re-validation before
 * signing, via the exported JSON Schema in shared/schema/json/).
 *
 * Bump SCHEMA_VERSION on any breaking change so prefill-era certificates can
 * coexist with manual-era ones (see CLAUDE.md, "PoC design hooks").
 */
export const SCHEMA_VERSION = 1 as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const isoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
    'Expected ISO 8601 date-time',
  );

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'Expected lowercase SHA-256 hex');

/** e.g. PWC-JHB-000123-00 (confirm scheme with Prowalco — open question #5) */
export const certificateNumberSchema = z
  .string()
  .regex(/^PWC-[A-Z]{2,5}-\d{6}-\d{2}$/, 'Expected PWC-{branch}-{sequence}-{revision}');

/** Field provenance — future On Key prefill records where a value came from. */
export const fieldSourceSchema = z.enum(['manual', 'onkey']);

export const provenanceEntrySchema = z.object({
  prefilled: z.boolean(),
  source: fieldSourceSchema,
  /** true if a technician edited a prefilled value — logged as a discrepancy */
  overridden: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Section 1 — Job & customer details
// ---------------------------------------------------------------------------

export const jobDetailsSchema = z.object({
  certificateNumber: certificateNumberSchema,
  /** Free text in PoC; becomes the On Key WO link in future state. */
  workOrderNumber: z.string().max(64).optional(),
  /** Stable internal customer ID (design hook for On Key/CRM); optional in PoC. */
  customerId: z.string().max(64).optional(),
  customerName: z.string().min(1).max(200),
  siteAddress: z.string().min(1).max(500),
  /** e.g. forecourt ID */
  siteAssetNumber: z.string().max(64).optional(),
  calibrationDate: isoDate,
  // issueDate is NOT part of the form: it is set by the backend at signing
  // time (TSA date) and stamped onto the signed PDF.
});

// ---------------------------------------------------------------------------
// Section 2 — Unit under test
// ---------------------------------------------------------------------------

export const equipmentTypeSchema = z.enum([
  'fuel_dispenser',
  'pump',
  'flow_meter',
  'pressure_transmitter',
  'other',
]);

export const productGradeSchema = z.enum([
  'ulp_93',
  'ulp_95',
  'diesel_50ppm',
  'diesel_500ppm',
  'paraffin',
  'other',
]);

export const uutSchema = z.object({
  equipmentType: equipmentTypeSchema,
  manufacturer: z.string().min(1).max(100), // Tatsuno default in UI
  modelNumber: z.string().min(1).max(100),
  serialNumber: z.string().min(1).max(100),
  /** Per-nozzle calibration identifier */
  nozzleId: z.string().max(64).optional(),
  productGrade: productGradeSchema,
  productGradeOther: z.string().max(100).optional(),
  meterKFactorBefore: z.number().finite().optional(),
});

// ---------------------------------------------------------------------------
// Section 3 — Reference standards
// ---------------------------------------------------------------------------

export const referenceStandardSchema = z.object({
  /** Stable ID from the equipment register */
  registerId: z.string().min(1).max(64),
  description: z.string().min(1).max(200),
  serialNumber: z.string().min(1).max(100),
  certificateNumber: z.string().min(1).max(100),
  /** Signing is blocked if this is before the calibration date. */
  calibrationDueDate: isoDate,
});

// ---------------------------------------------------------------------------
// Section 4 — Environment & method
// ---------------------------------------------------------------------------

export const uutConditionSchema = z.enum(['good', 'damaged', 'leaks_noted', 'other']);

export const environmentSchema = z.object({
  ambientTempC: z.number().gte(-20).lte(60),
  productTempC: z.number().gte(-20).lte(80),
  /** Controlled procedure reference, e.g. PWC-CP-001 */
  procedureRef: z.string().min(1).max(64),
  uutCondition: uutConditionSchema,
  conditionNotes: z.string().max(1000).optional(),
});

// ---------------------------------------------------------------------------
// Section 5 — Results
// ---------------------------------------------------------------------------

export const resultRowSchema = z.object({
  nominalDeliveryL: z.number().positive(),
  flowRateLpm: z.number().positive(),
  indicatedVolumeL: z.number().positive(),
  measuredVolumeL: z.number().positive(),
  // Computed client-side for display; recomputed and verified by the backend.
  errorMl: z.number().finite(),
  errorPercent: z.number().finite(),
  pass: z.boolean(),
  toleranceClassId: z.string().min(1),
});

export const photoRefSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(['seal', 'totaliser', 'display', 'other']),
  capturedAt: isoDateTime,
  sha256: sha256Hex,
});

export const resultsSchema = z
  .object({
    asFound: z.array(resultRowSchema).min(1, 'At least one as-found test point is required'),
    adjustmentPerformed: z.boolean(),
    asLeft: z.array(resultRowSchema).optional(),
    meterKFactorAfter: z.number().finite().optional(),
    /** Comes from the lab uncertainty budget config — not technician input. */
    uncertaintyStatement: z.string().min(1).max(500),
    remarks: z.string().max(2000).optional(),
    verificationSealNumbers: z.array(z.string().min(1).max(64)).default([]),
    photos: z.array(photoRefSchema).default([]),
  })
  .superRefine((val, ctx) => {
    if (val.adjustmentPerformed && (!val.asLeft || val.asLeft.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['asLeft'],
        message: 'As-left results are required when an adjustment was performed',
      });
    }
    if (!val.adjustmentPerformed && val.asLeft && val.asLeft.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['asLeft'],
        message: 'As-left results present but adjustmentPerformed is false',
      });
    }
  });

// ---------------------------------------------------------------------------
// Section 6 — Sign-off
// ---------------------------------------------------------------------------

export const authMethodSchema = z.enum(['microsoft', 'google', 'apple']);

export const technicianIdentitySchema = z.object({
  /** IdP subject claim (stable identifier) */
  subject: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  authMethod: authMethodSchema,
});

export const signOffSchema = z.object({
  calibratedBy: technicianIdentitySchema,
  technicalSignatory: z.object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
  }),
  /** "I certify these results are true and the procedure was followed" */
  declarationAccepted: z.boolean(),
});

// ---------------------------------------------------------------------------
// Full form
// ---------------------------------------------------------------------------

export const calibrationFormSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  job: jobDetailsSchema,
  uut: uutSchema,
  referenceStandards: z.array(referenceStandardSchema).min(1),
  environment: environmentSchema,
  results: resultsSchema,
  signOff: signOffSchema,
  /** Keyed by dotted field path, e.g. "job.customerName" */
  provenance: z.record(provenanceEntrySchema).optional(),
});

export type CalibrationForm = z.infer<typeof calibrationFormSchema>;
export type JobDetails = z.infer<typeof jobDetailsSchema>;
export type Uut = z.infer<typeof uutSchema>;
export type ReferenceStandard = z.infer<typeof referenceStandardSchema>;
export type Environment = z.infer<typeof environmentSchema>;
export type ResultRow = z.infer<typeof resultRowSchema>;
export type Results = z.infer<typeof resultsSchema>;
export type SignOff = z.infer<typeof signOffSchema>;
export type TechnicianIdentity = z.infer<typeof technicianIdentitySchema>;

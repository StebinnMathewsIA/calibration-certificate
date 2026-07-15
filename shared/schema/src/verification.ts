import { z } from 'zod';
import { hoseComponentsSchema } from './dispenser-detail';
import { DELIVERY_POINTS } from './tolerance';

/**
 * NRCS Verification Certificate for Liquid Fuel Dispensers (LM01HV) — the
 * single source of truth shared by the mobile app (react-hook-form validation)
 * and the backend (re-validation before signing, via the exported JSON Schema
 * in shared/schema/json/).
 *
 * Models both faces of the real document:
 *   - Doc A: the Verification Certificate (identity, components, sign-off)
 *   - Doc B: the Metrologist Note ("Reporting of Verification/Repair Results")
 *
 * One verification = one dispenser per visit; immutable once signed.
 *
 * Bump SCHEMA_VERSION on any breaking change so records from different eras
 * coexist (see CLAUDE.md, schema versioning).
 */
export const SCHEMA_VERSION = 2 as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const isoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
    'Expected ISO 8601 date-time',
  );

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'Expected lowercase SHA-256 hex');

/** e.g. PWC-JHB-000123-00 (system certificate number; the pre-printed NRCS
 * booklet number is captured separately as `nrcsBookNumber`). */
export const certificateNumberSchema = z
  .string()
  .regex(/^PWC-[A-Z]{2,5}-\d{6}-\d{2}$/, 'Expected PWC-{branch}-{sequence}-{revision}');

/** Field provenance — records where a value came from (OnKey seed vs manual)
 * for the audit trail. */
export const fieldSourceSchema = z.enum(['manual', 'onkey']);

export const provenanceEntrySchema = z.object({
  prefilled: z.boolean(),
  source: fieldSourceSchema,
  /** true if a technician edited a prefilled value — logged as a discrepancy */
  overridden: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Identity (Doc A)
// ---------------------------------------------------------------------------

/** Site/customer identity snapshotted onto the certificate. */
export const verificationSiteSchema = z.object({
  /** Oil Company. */
  customerName: z.string().min(1).max(200),
  /** Name (User) — site/depot name. */
  siteName: z.string().min(1).max(200),
  address: z.string().min(1).max(500),
  telephone: z.string().max(64).optional(),
});

/** Dispenser (LFD) identity snapshotted onto the certificate. */
export const verificationDispenserSchema = z.object({
  /** Stable internal dispenser ID (from OnKey seed or manually added). */
  dispenserId: z.string().min(1).max(64),
  /** "Make & Model". */
  makeModel: z.string().min(1).max(200),
  saApprovalNumber: z.string().min(1).max(100),
  serialNumber: z.string().min(1).max(100),
  /** Dispenser-level "Security Seal No.". */
  securitySealNumber: z.string().max(64).optional(),
});

/** A reference proving measure used for the verification (200 / 20 / 5 L).
 * Traceable to the national standard; blocks signing when expired. */
export const referenceMeasureSchema = z.object({
  size: z.enum(['200L', '20L', '5L']),
  serialNumber: z.string().min(1).max(100),
  certificateNumber: z.string().min(1).max(100),
  calibrationDate: isoDate,
  /** Signing is blocked if this is before the verification date. */
  expiryDate: isoDate,
});

// ---------------------------------------------------------------------------
// Results (Doc B — Metrologist Note)
// ---------------------------------------------------------------------------

/** Outcome of each circled Pass/Fail checklist item. */
export const checklistOutcomeSchema = z.enum(['pass', 'fail', 'na']);

/** The pass/fail checklist performed per hose on the Metrologist Note. */
export const checklistSchema = z.object({
  constructionMarking: checklistOutcomeSchema,
  computerComputation: checklistOutcomeSchema,
  hydraulics: checklistOutcomeSchema,
  interlockingDevices: checklistOutcomeSchema,
  hoseNozzleAutoStop: checklistOutcomeSchema,
  solenoidValveTest: checklistOutcomeSchema,
  presetTest: checklistOutcomeSchema,
  measuresConformSans1698: checklistOutcomeSchema,
  timeOut: checklistOutcomeSchema,
  /** Nozzle burst / hose dilation — pressed for 30 s. */
  nozzleBurst: checklistOutcomeSchema,
  /** Advance of indication (zero setting). */
  zeroSetting: checklistOutcomeSchema,
});

/** Per-hose verification/repair status (Verification Status / Repair Status). */
export const hoseStatusSchema = z.enum(['new', 'repaired', 'atu', 'rejected']);

/** Test condition of the product at delivery. */
export const testConditionSchema = z.enum(['hot', 'cold']);

/** One EFD delivery: the dispenser vs the reference measure at a flow rate. */
export const deliverySchema = z.object({
  point: z.enum(DELIVERY_POINTS),
  flowRateLpm: z.number().positive(),
  /** VFD — volume indicated by the dispenser. */
  vfdMl: z.number().positive(),
  /** VREF — volume indicated by the reference measure. */
  vrefMl: z.number().positive(),
  /** EFD = (VFD − VREF)/VREF × 100 — computed client-side, verified server-side. */
  efdPercent: z.number().finite(),
  pass: z.boolean(),
});

/** Instrument outcome for the hose. */
export const hoseOutcomeSchema = z.enum(['certified', 'rejected']);

/** All results for one hose/pump. */
export const hoseResultSchema = z.object({
  /** "Hose/Pump No." */
  hoseNumber: z.string().min(1).max(32),
  product: z.string().min(1).max(64),
  status: hoseStatusSchema,
  /** Component identity snapshot (meter/PC board/pulsar/solenoid). */
  components: hoseComponentsSchema,
  securitySeal: z.string().max(64).optional(),
  totalizerBefore: z.number().finite().optional(),
  totalizerAfter: z.number().finite().optional(),
  quantityDelivered: z.number().finite().optional(),
  testCondition: testConditionSchema,
  /** Data-plate flow range (L/min). */
  qMinLpm: z.number().positive().optional(),
  qMaxLpm: z.number().positive().optional(),
  checklist: checklistSchema,
  deliveries: z.array(deliverySchema).min(1, 'At least one delivery is required'),
  outcome: hoseOutcomeSchema,
  comments: z.string().max(2000).optional(),
});

// ---------------------------------------------------------------------------
// Sign-off (Doc A)
// ---------------------------------------------------------------------------

export const authMethodSchema = z.enum(['microsoft', 'google', 'apple']);

export const technicianIdentitySchema = z.object({
  /** IdP subject claim (stable identifier). */
  subject: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  authMethod: authMethodSchema,
});

export const signOffSchema = z.object({
  /** Verifying Officer = the logged-in technician (cryptographic signatory). */
  vo: z.object({
    identity: technicianIdentitySchema,
    /** VO Pliers No. — the technician's controlled sealing-plier identifier. */
    pliersNumber: z.string().min(1).max(64),
  }),
  /** Client acknowledgement — a captured handwritten signature (no credentials). */
  client: z.object({
    name: z.string().min(1).max(200),
  }),
  /** "I certify the instrument was tested per the Legal Metrology Act …" */
  declarationAccepted: z.boolean(),
  /** Expiry Date of Certificate. */
  expiryDate: isoDate.optional(),
  /** Rejection Cert. No. (if applicable) — present when any hose is rejected. */
  rejectionCertNumber: z.string().max(100).optional(),
});

// ---------------------------------------------------------------------------
// Full verification
// ---------------------------------------------------------------------------

export const reportTypeSchema = z.enum(['verification', 'repair']);

export const DEFAULT_METHOD_REFERENCE =
  'SANS Test Proc 01 & SANS Test Proc 02 based on LM-IR 117-2: 2023';

export const verificationSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  certificateNumber: certificateNumberSchema,
  /** Pre-printed NRCS booklet number, e.g. "139458". */
  nrcsBookNumber: z.string().max(32).optional(),
  reportType: reportTypeSchema,
  site: verificationSiteSchema,
  /** Job Ref. No. — free text in PoC; the OnKey WO reference in future state. */
  jobReference: z.string().max(64).optional(),
  workOrderId: z.string().max(64).optional(),
  dispenser: verificationDispenserSchema,
  referenceMeasures: z.array(referenceMeasureSchema).min(1),
  methodReference: z.string().min(1).max(200),
  hoses: z.array(hoseResultSchema).min(1, 'At least one hose result is required'),
  signOff: signOffSchema,
  /** Verification date (default today). issueDate is set by the backend at
   * signing time (TSA date) and stamped onto the signed PDF. */
  verificationDate: isoDate,
  /** Keyed by dotted field path, e.g. "site.customerName". */
  provenance: z.record(provenanceEntrySchema).optional(),
});

export type VerificationSite = z.infer<typeof verificationSiteSchema>;
export type VerificationDispenser = z.infer<typeof verificationDispenserSchema>;
export type ReferenceMeasure = z.infer<typeof referenceMeasureSchema>;
export type Checklist = z.infer<typeof checklistSchema>;
export type ChecklistOutcome = z.infer<typeof checklistOutcomeSchema>;
export type HoseStatus = z.infer<typeof hoseStatusSchema>;
export type TestCondition = z.infer<typeof testConditionSchema>;
export type Delivery = z.infer<typeof deliverySchema>;
export type HoseOutcome = z.infer<typeof hoseOutcomeSchema>;
export type HoseResult = z.infer<typeof hoseResultSchema>;
export type SignOff = z.infer<typeof signOffSchema>;
export type ReportType = z.infer<typeof reportTypeSchema>;
export type TechnicianIdentity = z.infer<typeof technicianIdentitySchema>;
export type Verification = z.infer<typeof verificationSchema>;

/** Checklist items in report order, with their display labels. */
export const CHECKLIST_ITEMS: { key: keyof Checklist; label: string }[] = [
  { key: 'constructionMarking', label: 'Construction & Marking' },
  { key: 'computerComputation', label: 'Computer / Computation' },
  { key: 'hydraulics', label: 'Hydraulics' },
  { key: 'interlockingDevices', label: 'Interlocking devices' },
  { key: 'hoseNozzleAutoStop', label: 'Hose and nozzle (auto stop)' },
  { key: 'solenoidValveTest', label: 'Solenoid valve test' },
  { key: 'presetTest', label: 'Preset Test' },
  { key: 'measuresConformSans1698', label: 'Measures conform to SANS 1698' },
  { key: 'timeOut', label: 'Time out' },
  { key: 'nozzleBurst', label: 'Nozzle burst (hose dilation) — press 30 s' },
  { key: 'zeroSetting', label: 'Advance of indication (zero setting)' },
];

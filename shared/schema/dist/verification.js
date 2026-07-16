"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHECKLIST_ITEMS = exports.verificationSchema = exports.DEFAULT_METHOD_REFERENCE = exports.reportTypeSchema = exports.signOffSchema = exports.technicianIdentitySchema = exports.authMethodSchema = exports.hoseResultSchema = exports.hoseOutcomeSchema = exports.deliverySchema = exports.testConditionSchema = exports.hoseStatusSchema = exports.checklistSchema = exports.checklistOutcomeSchema = exports.referenceMeasureSchema = exports.verificationDispenserSchema = exports.verificationSiteSchema = exports.provenanceEntrySchema = exports.fieldSourceSchema = exports.certificateNumberSchema = exports.SCHEMA_VERSION = void 0;
const zod_1 = require("zod");
const dispenser_detail_1 = require("./dispenser-detail");
const tolerance_1 = require("./tolerance");
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
exports.SCHEMA_VERSION = 2;
const isoDate = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const isoDateTime = zod_1.z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/, 'Expected ISO 8601 date-time');
const sha256Hex = zod_1.z.string().regex(/^[0-9a-f]{64}$/, 'Expected lowercase SHA-256 hex');
/** e.g. PWC-JHB-000123-00 (system certificate number; the pre-printed NRCS
 * booklet number is captured separately as `nrcsBookNumber`). */
exports.certificateNumberSchema = zod_1.z
    .string()
    .regex(/^PWC-[A-Z]{2,5}-\d{6}-\d{2}$/, 'Expected PWC-{branch}-{sequence}-{revision}');
/** Field provenance — records where a value came from (OnKey seed vs manual)
 * for the audit trail. */
exports.fieldSourceSchema = zod_1.z.enum(['manual', 'onkey']);
exports.provenanceEntrySchema = zod_1.z.object({
    prefilled: zod_1.z.boolean(),
    source: exports.fieldSourceSchema,
    /** true if a technician edited a prefilled value — logged as a discrepancy */
    overridden: zod_1.z.boolean().optional(),
});
// ---------------------------------------------------------------------------
// Identity (Doc A)
// ---------------------------------------------------------------------------
/** Site/customer identity snapshotted onto the certificate. */
exports.verificationSiteSchema = zod_1.z.object({
    /** Oil Company. */
    customerName: zod_1.z.string().min(1).max(200),
    /** Name (User) — site/depot name. */
    siteName: zod_1.z.string().min(1).max(200),
    address: zod_1.z.string().min(1).max(500),
    telephone: zod_1.z.string().max(64).optional(),
});
/** Dispenser (LFD) identity snapshotted onto the certificate. */
exports.verificationDispenserSchema = zod_1.z.object({
    /** Stable internal dispenser ID (from OnKey seed or manually added). */
    dispenserId: zod_1.z.string().min(1).max(64),
    /** "Make & Model". */
    makeModel: zod_1.z.string().min(1).max(200),
    saApprovalNumber: zod_1.z.string().min(1).max(100),
    serialNumber: zod_1.z.string().min(1).max(100),
    /** Dispenser-level "Security Seal No.". */
    securitySealNumber: zod_1.z.string().max(64).optional(),
});
/** A reference proving measure used for the verification (200 / 20 / 5 L).
 * Traceable to the national standard; blocks signing when expired. */
exports.referenceMeasureSchema = zod_1.z.object({
    size: zod_1.z.enum(['200L', '20L', '5L']),
    serialNumber: zod_1.z.string().min(1).max(100),
    certificateNumber: zod_1.z.string().min(1).max(100),
    calibrationDate: isoDate,
    /** Signing is blocked if this is before the verification date. */
    expiryDate: isoDate,
});
// ---------------------------------------------------------------------------
// Results (Doc B — Metrologist Note)
// ---------------------------------------------------------------------------
/** Outcome of each circled Pass/Fail checklist item. */
exports.checklistOutcomeSchema = zod_1.z.enum(['pass', 'fail', 'na']);
/** The pass/fail checklist performed per hose on the Metrologist Note. */
exports.checklistSchema = zod_1.z.object({
    constructionMarking: exports.checklistOutcomeSchema,
    computerComputation: exports.checklistOutcomeSchema,
    hydraulics: exports.checklistOutcomeSchema,
    interlockingDevices: exports.checklistOutcomeSchema,
    hoseNozzleAutoStop: exports.checklistOutcomeSchema,
    solenoidValveTest: exports.checklistOutcomeSchema,
    presetTest: exports.checklistOutcomeSchema,
    measuresConformSans1698: exports.checklistOutcomeSchema,
    timeOut: exports.checklistOutcomeSchema,
    /** Nozzle burst / hose dilation — pressed for 30 s. */
    nozzleBurst: exports.checklistOutcomeSchema,
    /** Advance of indication (zero setting). */
    zeroSetting: exports.checklistOutcomeSchema,
});
/** Per-hose verification/repair status (Verification Status / Repair Status). */
exports.hoseStatusSchema = zod_1.z.enum(['new', 'repaired', 'atu', 'rejected']);
/** Test condition of the product at delivery. */
exports.testConditionSchema = zod_1.z.enum(['hot', 'cold']);
/** One EFD delivery: the dispenser vs the reference measure at a flow rate. */
exports.deliverySchema = zod_1.z.object({
    point: zod_1.z.enum(tolerance_1.DELIVERY_POINTS),
    flowRateLpm: zod_1.z.number().positive(),
    /** VFD — volume indicated by the dispenser. */
    vfdMl: zod_1.z.number().positive(),
    /** VREF — volume indicated by the reference measure. */
    vrefMl: zod_1.z.number().positive(),
    /** EFD = (VFD − VREF)/VREF × 100 — computed client-side, verified server-side. */
    efdPercent: zod_1.z.number().finite(),
    pass: zod_1.z.boolean(),
});
/** Instrument outcome for the hose. */
exports.hoseOutcomeSchema = zod_1.z.enum(['certified', 'rejected']);
/** All results for one hose/pump. */
exports.hoseResultSchema = zod_1.z.object({
    /** "Hose/Pump No." */
    hoseNumber: zod_1.z.string().min(1).max(32),
    product: zod_1.z.string().min(1).max(64),
    status: exports.hoseStatusSchema,
    /** Component identity snapshot (meter/PC board/pulsar/solenoid). */
    components: dispenser_detail_1.hoseComponentsSchema,
    securitySeal: zod_1.z.string().max(64).optional(),
    totalizerBefore: zod_1.z.number().finite().optional(),
    totalizerAfter: zod_1.z.number().finite().optional(),
    quantityDelivered: zod_1.z.number().finite().optional(),
    testCondition: exports.testConditionSchema,
    /** Data-plate flow range (L/min). */
    qMinLpm: zod_1.z.number().positive().optional(),
    qMaxLpm: zod_1.z.number().positive().optional(),
    checklist: exports.checklistSchema,
    deliveries: zod_1.z.array(exports.deliverySchema).min(1, 'At least one delivery is required'),
    outcome: exports.hoseOutcomeSchema,
    comments: zod_1.z.string().max(2000).optional(),
});
// ---------------------------------------------------------------------------
// Sign-off (Doc A)
// ---------------------------------------------------------------------------
exports.authMethodSchema = zod_1.z.enum(['microsoft', 'google', 'apple']);
exports.technicianIdentitySchema = zod_1.z.object({
    /** IdP subject claim (stable identifier). */
    subject: zod_1.z.string().min(1).max(200),
    name: zod_1.z.string().min(1).max(200),
    authMethod: exports.authMethodSchema,
});
exports.signOffSchema = zod_1.z.object({
    /** Verifying Officer = the logged-in technician (cryptographic signatory). */
    vo: zod_1.z.object({
        identity: exports.technicianIdentitySchema,
        /** VO Pliers No. — the technician's controlled sealing-plier identifier. */
        pliersNumber: zod_1.z.string().min(1).max(64),
    }),
    /** Client acknowledgement — a captured handwritten signature (no credentials). */
    client: zod_1.z.object({
        name: zod_1.z.string().min(1).max(200),
    }),
    /** "I certify the instrument was tested per the Legal Metrology Act …" */
    declarationAccepted: zod_1.z.boolean(),
    /** Expiry Date of Certificate. */
    expiryDate: isoDate.optional(),
    /** Rejection Cert. No. (if applicable) — present when any hose is rejected. */
    rejectionCertNumber: zod_1.z.string().max(100).optional(),
});
// ---------------------------------------------------------------------------
// Full verification
// ---------------------------------------------------------------------------
exports.reportTypeSchema = zod_1.z.enum(['verification', 'repair']);
exports.DEFAULT_METHOD_REFERENCE = 'SANS Test Proc 01 & SANS Test Proc 02 based on LM-IR 117-2: 2023';
exports.verificationSchema = zod_1.z.object({
    schemaVersion: zod_1.z.literal(exports.SCHEMA_VERSION),
    certificateNumber: exports.certificateNumberSchema,
    /** Pre-printed NRCS booklet number, e.g. "139458". */
    nrcsBookNumber: zod_1.z.string().max(32).optional(),
    reportType: exports.reportTypeSchema,
    site: exports.verificationSiteSchema,
    /** Job Ref. No. — free text in PoC; the OnKey WO reference in future state. */
    jobReference: zod_1.z.string().max(64).optional(),
    workOrderId: zod_1.z.string().max(64).optional(),
    dispenser: exports.verificationDispenserSchema,
    referenceMeasures: zod_1.z.array(exports.referenceMeasureSchema).min(1),
    methodReference: zod_1.z.string().min(1).max(200),
    hoses: zod_1.z.array(exports.hoseResultSchema).min(1, 'At least one hose result is required'),
    signOff: exports.signOffSchema,
    /** Verification date (default today). issueDate is set by the backend at
     * signing time (TSA date) and stamped onto the signed PDF. */
    verificationDate: isoDate,
    /** Keyed by dotted field path, e.g. "site.customerName". */
    provenance: zod_1.z.record(exports.provenanceEntrySchema).optional(),
});
/** Checklist items in report order, with their display labels. */
exports.CHECKLIST_ITEMS = [
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

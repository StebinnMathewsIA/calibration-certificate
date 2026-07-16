"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispenserDetailSchema = exports.hoseDetailSchema = exports.hoseComponentsSchema = exports.componentSchema = exports.dispenserRecordSchema = exports.siteRecordSchema = exports.dispenserStatusSchema = exports.recordSourceSchema = void 0;
const zod_1 = require("zod");
/**
 * INTERNAL objects — the records we own, complete, and persist (Supabase +
 * offline mirror). These are seeded from OnKey when data exists, filled in by
 * the technician when it doesn't, and reused on the next visit so the register
 * OnKey lacks is built up over time.
 *
 *  - siteRecord / dispenserRecord: our canonical copy of identity (source of
 *    truth for missing/incorrect OnKey data). Mutable — corrected over time.
 *  - dispenserDetail: the per-dispenser component register (pumps/hoses/
 *    components) that OnKey has no concept of. Entered once, prefilled next time.
 */
const isoDate = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const isoDateTime = zod_1.z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/, 'Expected ISO 8601 date-time');
/** Where a canonical record's identity originated. */
exports.recordSourceSchema = zod_1.z.enum(['onkey', 'manual']);
/** A dispenser can be retired (soft) but never hard-deleted — issued
 * verifications stay immutable and the history is preserved for the audit. */
exports.dispenserStatusSchema = zod_1.z.enum(['active', 'retired']);
// ---------------------------------------------------------------------------
// Canonical site record
// ---------------------------------------------------------------------------
exports.siteRecordSchema = zod_1.z.object({
    id: zod_1.z.string().min(1).max(64),
    /** Oil Company. */
    customerName: zod_1.z.string().min(1).max(200),
    /** Name (User) — site/depot name. */
    siteName: zod_1.z.string().min(1).max(200),
    address: zod_1.z.string().min(1).max(500),
    telephone: zod_1.z.string().max(64).optional(),
    source: exports.recordSourceSchema,
    updatedAt: isoDateTime,
});
// ---------------------------------------------------------------------------
// Canonical dispenser record (with lifecycle)
// ---------------------------------------------------------------------------
exports.dispenserRecordSchema = zod_1.z.object({
    id: zod_1.z.string().min(1).max(64),
    siteId: zod_1.z.string().min(1).max(64),
    make: zod_1.z.string().min(1).max(100),
    model: zod_1.z.string().min(1).max(100),
    serialNumber: zod_1.z.string().min(1).max(100),
    saApprovalNumber: zod_1.z.string().min(1).max(100),
    status: exports.dispenserStatusSchema,
    source: exports.recordSourceSchema,
    addedBy: zod_1.z.string().max(200).optional(),
    addedAt: isoDateTime.optional(),
    retiredBy: zod_1.z.string().max(200).optional(),
    retiredAt: isoDateTime.optional(),
    updatedAt: isoDateTime,
});
// ---------------------------------------------------------------------------
// Component register (per dispenser) — the data OnKey lacks
// ---------------------------------------------------------------------------
/** One physical component (meter / PC board / pulsar / solenoid valve).
 * Identity may be partially unknown on first capture. */
exports.componentSchema = zod_1.z.object({
    make: zod_1.z.string().max(100).optional(),
    model: zod_1.z.string().max(100).optional(),
    serial: zod_1.z.string().max(100).optional(),
    saApproval: zod_1.z.string().max(100).optional(),
});
/** The four components verified per hose on the NRCS certificate. */
exports.hoseComponentsSchema = zod_1.z.object({
    meter: exports.componentSchema,
    pcBoard: exports.componentSchema,
    pulsar: exports.componentSchema,
    solenoid: exports.componentSchema,
});
/** A hose/pump on the dispenser: its product and its four components. */
exports.hoseDetailSchema = zod_1.z.object({
    /** "Hose/Pump No." on the certificate. */
    hoseNumber: zod_1.z.string().min(1).max(32),
    /** Fuel grade delivered, e.g. "ULP 95", "Diesel 50ppm". */
    product: zod_1.z.string().min(1).max(64),
    securitySeal: zod_1.z.string().max(64).optional(),
    components: exports.hoseComponentsSchema,
});
/** The full per-dispenser register: data-plate flow range + all hoses.
 * Entered once, saved against the dispenser, prefilled next verification. */
exports.dispenserDetailSchema = zod_1.z.object({
    dispenserId: zod_1.z.string().min(1).max(64),
    /** Data-plate minimum flow rate (L/min). */
    qMinLpm: zod_1.z.number().positive().optional(),
    /** Data-plate maximum flow rate (L/min). */
    qMaxLpm: zod_1.z.number().positive().optional(),
    hoses: zod_1.z.array(exports.hoseDetailSchema).default([]),
    updatedAt: isoDateTime.optional(),
});

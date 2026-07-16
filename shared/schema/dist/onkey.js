"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workOrderBundleSchema = exports.workOrderSeedSchema = exports.dispenserSeedSchema = exports.siteSeedSchema = exports.technicianSeedSchema = exports.workOrderStatusSchema = void 0;
const zod_1 = require("zod");
/**
 * EXTERNAL objects — the *simulated* OnKey seed.
 *
 * These mirror what Prowalco's asset system (OnKey / Pragma EAM) can provide
 * today: work orders assigned to a technician, and site + dispenser identity
 * down to **dispenser level only** (nothing about individual pumps/hoses or
 * their components — that lives in our own register, see dispenser-detail.ts).
 *
 * They are a **read-only SEED, not the truth**: any field may be missing, and
 * the technician completes/corrects it on-device. We persist the corrected
 * value as our canonical record (dispenser-detail.ts) and reuse it next visit.
 * Nothing is ever written back to OnKey.
 *
 * The shapes are deliberately the same ones a real `OnKeyProvider` would
 * return, so the simulator swaps for the real integration by changing one
 * backend module — no schema change.
 */
exports.workOrderStatusSchema = zod_1.z.enum(['open', 'in_progress', 'completed']);
const isoDate = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
/** A technician resource in OnKey. The sign-in email is the join key that
 * drives which work orders they see. */
exports.technicianSeedSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    name: zod_1.z.string().min(1).max(200).optional(),
});
/** Site / customer identity. Every field except `id` may be blank in OnKey —
 * "Oil Company" and "Name (User)" on the certificate. */
exports.siteSeedSchema = zod_1.z.object({
    id: zod_1.z.string().min(1).max(64),
    /** Oil Company, e.g. "Engen", "Shell". */
    customerName: zod_1.z.string().max(200).optional(),
    /** Name (User) — the site/depot name, e.g. "North Road Fuel Depot". */
    siteName: zod_1.z.string().max(200).optional(),
    address: zod_1.z.string().max(500).optional(),
    telephone: zod_1.z.string().max(64).optional(),
});
/** A dispenser asset. OnKey stops at this level of granularity; identity may
 * be blank and is completed by the technician. Nothing below the dispenser
 * (pumps/hoses/components) exists in OnKey. */
exports.dispenserSeedSchema = zod_1.z.object({
    id: zod_1.z.string().min(1).max(64),
    siteId: zod_1.z.string().min(1).max(64),
    make: zod_1.z.string().max(100).optional(),
    model: zod_1.z.string().max(100).optional(),
    serialNumber: zod_1.z.string().max(100).optional(),
    /** NRCS type/SA approval number of the dispenser. */
    saApprovalNumber: zod_1.z.string().max(100).optional(),
});
/** A work order = one site visit. 1 WO = one site; the technician picks which
 * of the WO's dispensers to verify (one certificate per dispenser). */
exports.workOrderSeedSchema = zod_1.z.object({
    id: zod_1.z.string().min(1).max(64),
    /** Human-facing WO reference, e.g. "WO-4711". */
    reference: zod_1.z.string().min(1).max(64),
    assignedTechnicianEmail: zod_1.z.string().email(),
    siteId: zod_1.z.string().min(1).max(64),
    dispenserIds: zod_1.z.array(zod_1.z.string().min(1).max(64)).default([]),
    status: exports.workOrderStatusSchema.default('open'),
    scheduledDate: isoDate.optional(),
});
/** The full seed bundle a provider returns for one work order. */
exports.workOrderBundleSchema = zod_1.z.object({
    workOrder: exports.workOrderSeedSchema,
    site: exports.siteSeedSchema,
    dispensers: zod_1.z.array(exports.dispenserSeedSchema).default([]),
});

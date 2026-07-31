"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rejectionCertificateSchema = exports.rejectedHoseSchema = exports.REJECTION_SCHEMA_VERSION = void 0;
const zod_1 = require("zod");
const verification_1 = require("./verification");
/**
 * Rejection certificate (#92) — the first document type beyond the
 * verification certificate (paper: SANS FM19). Created from an ISSUED
 * verification on which one or more hoses were rejected, sealed through the
 * same signing pipeline (documentType 'rejection-certificate'), archived
 * and shareable. Delivery of the NRCS copy is a later phase; numbering is
 * parent certificate number + '-REJ' until the QM confirms how FM19
 * numbers are assigned.
 */
const isoDate = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
exports.REJECTION_SCHEMA_VERSION = 1;
exports.rejectedHoseSchema = zod_1.z.object({
    hoseNumber: zod_1.z.string().min(1).max(32),
    product: zod_1.z.string().min(1).max(64),
    /** Why the hose was rejected: derived from the failed evidence, plus any
     * VO additions. At least one reason is mandatory. */
    reasons: zod_1.z.array(zod_1.z.string().min(1).max(300)).min(1),
});
exports.rejectionCertificateSchema = zod_1.z.object({
    schemaVersion: zod_1.z.literal(exports.REJECTION_SCHEMA_VERSION),
    /** Rejection certificate number (placeholder scheme: parent + '-REJ'). */
    rejectionNumber: zod_1.z.string().min(1).max(64),
    /** The issued verification certificate this rejection arises from. */
    parentCertificateNumber: zod_1.z.string().min(1).max(64),
    /** Canonical site id — indexes the document into site history. */
    siteId: zod_1.z.string().min(1).max(64),
    site: verification_1.verificationSiteSchema,
    dispenser: verification_1.verificationDispenserSchema,
    rejectedHoses: zod_1.z.array(exports.rejectedHoseSchema).min(1),
    /** PROC02 5.5 physical steps, confirmed by the VO before sealing. */
    confirmations: zod_1.z.object({
        marksObliterated: zod_1.z.literal(true),
        rejectionMarkApplied: zod_1.z.literal(true),
        nozzleSwitchRemoved: zod_1.z.literal(true),
    }),
    vo: zod_1.z.object({
        identity: verification_1.technicianIdentitySchema,
        pliersNumber: zod_1.z.string().min(1).max(64),
    }),
    rejectionDate: isoDate,
});

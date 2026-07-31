import { z } from 'zod';
import {
  technicianIdentitySchema,
  verificationDispenserSchema,
  verificationSiteSchema,
} from './verification';

/**
 * Rejection certificate (#92) — the first document type beyond the
 * verification certificate (paper: SANS FM19). Created from an ISSUED
 * verification on which one or more hoses were rejected, sealed through the
 * same signing pipeline (documentType 'rejection-certificate'), archived
 * and shareable. Delivery of the NRCS copy is a later phase; numbering is
 * parent certificate number + '-REJ' until the QM confirms how FM19
 * numbers are assigned.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const REJECTION_SCHEMA_VERSION = 1;

export const rejectedHoseSchema = z.object({
  hoseNumber: z.string().min(1).max(32),
  product: z.string().min(1).max(64),
  /** Why the hose was rejected: derived from the failed evidence, plus any
   * VO additions. At least one reason is mandatory. */
  reasons: z.array(z.string().min(1).max(300)).min(1),
});

export const rejectionCertificateSchema = z.object({
  schemaVersion: z.literal(REJECTION_SCHEMA_VERSION),
  /** Rejection certificate number (placeholder scheme: parent + '-REJ'). */
  rejectionNumber: z.string().min(1).max(64),
  /** The issued verification certificate this rejection arises from. */
  parentCertificateNumber: z.string().min(1).max(64),
  /** Canonical site id — indexes the document into site history. */
  siteId: z.string().min(1).max(64),
  site: verificationSiteSchema,
  dispenser: verificationDispenserSchema,
  rejectedHoses: z.array(rejectedHoseSchema).min(1),
  /** PROC02 5.5 physical steps, confirmed by the VO before sealing. */
  confirmations: z.object({
    marksObliterated: z.literal(true),
    rejectionMarkApplied: z.literal(true),
    nozzleSwitchRemoved: z.literal(true),
  }),
  vo: z.object({
    identity: technicianIdentitySchema,
    pliersNumber: z.string().min(1).max(64),
  }),
  rejectionDate: isoDate,
});

export type RejectedHose = z.infer<typeof rejectedHoseSchema>;
export type RejectionCertificate = z.infer<typeof rejectionCertificateSchema>;

import { z } from 'zod';

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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const isoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
    'Expected ISO 8601 date-time',
  );

/** Where a canonical record's identity originated. */
export const recordSourceSchema = z.enum(['onkey', 'manual']);
export type RecordSource = z.infer<typeof recordSourceSchema>;

/** A dispenser can be retired (soft) but never hard-deleted — issued
 * verifications stay immutable and the history is preserved for the audit. */
export const dispenserStatusSchema = z.enum(['active', 'retired']);
export type DispenserStatus = z.infer<typeof dispenserStatusSchema>;

// ---------------------------------------------------------------------------
// Canonical site record
// ---------------------------------------------------------------------------

export const siteRecordSchema = z.object({
  id: z.string().min(1).max(64),
  /** Oil Company. */
  customerName: z.string().min(1).max(200),
  /** Name (User) — site/depot name. */
  siteName: z.string().min(1).max(200),
  address: z.string().min(1).max(500),
  telephone: z.string().max(64).optional(),
  source: recordSourceSchema,
  updatedAt: isoDateTime,
});
export type SiteRecord = z.infer<typeof siteRecordSchema>;

// ---------------------------------------------------------------------------
// Canonical dispenser record (with lifecycle)
// ---------------------------------------------------------------------------

export const dispenserRecordSchema = z.object({
  id: z.string().min(1).max(64),
  siteId: z.string().min(1).max(64),
  make: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  serialNumber: z.string().min(1).max(100),
  saApprovalNumber: z.string().min(1).max(100),
  status: dispenserStatusSchema,
  source: recordSourceSchema,
  addedBy: z.string().max(200).optional(),
  addedAt: isoDateTime.optional(),
  retiredBy: z.string().max(200).optional(),
  retiredAt: isoDateTime.optional(),
  updatedAt: isoDateTime,
});
export type DispenserRecord = z.infer<typeof dispenserRecordSchema>;

// ---------------------------------------------------------------------------
// Component register (per dispenser) — the data OnKey lacks
// ---------------------------------------------------------------------------

/** One physical component (meter / PC board / pulsar / solenoid valve).
 * Identity may be partially unknown on first capture. */
export const componentSchema = z.object({
  make: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  serial: z.string().max(100).optional(),
  saApproval: z.string().max(100).optional(),
});
export type Component = z.infer<typeof componentSchema>;

/** The four components verified per hose on the NRCS certificate. */
export const hoseComponentsSchema = z.object({
  meter: componentSchema,
  pcBoard: componentSchema,
  pulsar: componentSchema,
  solenoid: componentSchema,
});
export type HoseComponents = z.infer<typeof hoseComponentsSchema>;

/** A hose/pump on the dispenser: its product and its four components. */
export const hoseDetailSchema = z.object({
  /** "Hose/Pump No." on the certificate. */
  hoseNumber: z.string().min(1).max(32),
  /** Fuel grade delivered, e.g. "ULP 95", "Diesel 50ppm". */
  product: z.string().min(1).max(64),
  securitySeal: z.string().max(64).optional(),
  components: hoseComponentsSchema,
});
export type HoseDetail = z.infer<typeof hoseDetailSchema>;

/** The full per-dispenser register: data-plate flow range + all hoses.
 * Entered once, saved against the dispenser, prefilled next verification. */
export const dispenserDetailSchema = z.object({
  dispenserId: z.string().min(1).max(64),
  /** Data-plate minimum flow rate (L/min). */
  qMinLpm: z.number().positive().optional(),
  /** Data-plate maximum flow rate (L/min). */
  qMaxLpm: z.number().positive().optional(),
  hoses: z.array(hoseDetailSchema).default([]),
  updatedAt: isoDateTime.optional(),
});
export type DispenserDetail = z.infer<typeof dispenserDetailSchema>;

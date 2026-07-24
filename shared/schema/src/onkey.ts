import { z } from 'zod';

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

export const workOrderStatusSchema = z.enum(['open', 'in_progress', 'completed']);
export type WorkOrderStatus = z.infer<typeof workOrderStatusSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/** A technician resource in OnKey. The sign-in email is the join key that
 * drives which work orders they see. */
export const technicianSeedSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200).optional(),
});

/** Site / customer identity. Every field except `id` may be blank in OnKey —
 * "Oil Company" and "Name (User)" on the certificate. */
export const siteSeedSchema = z.object({
  id: z.string().min(1).max(64),
  /** Oil Company, e.g. "Engen", "Shell". */
  customerName: z.string().max(200).optional(),
  /** Name (User) — the site/depot name, e.g. "North Road Fuel Depot". */
  siteName: z.string().max(200).optional(),
  address: z.string().max(500).optional(),
  telephone: z.string().max(64).optional(),
});

/** A dispenser asset. OnKey stops at this level of granularity; identity may
 * be blank and is completed by the technician. Nothing below the dispenser
 * (pumps/hoses/components) exists in OnKey. */
export const dispenserSeedSchema = z.object({
  id: z.string().min(1).max(64),
  siteId: z.string().min(1).max(64),
  make: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  serialNumber: z.string().max(100).optional(),
  /** NRCS type/SA approval number of the dispenser. */
  saApprovalNumber: z.string().max(100).optional(),
});

/** A work order = one site visit. 1 WO = one site; the technician picks which
 * of the WO's dispensers to verify (one certificate per dispenser). */
export const workOrderSeedSchema = z.object({
  id: z.string().min(1).max(64),
  /** Human-facing WO reference, e.g. "WO-4711". */
  reference: z.string().min(1).max(64),
  assignedTechnicianEmail: z.string().email(),
  siteId: z.string().min(1).max(64),
  dispenserIds: z.array(z.string().min(1).max(64)).default([]),
  status: workOrderStatusSchema.default('open'),
  /** Raw OnKey queue status (e.g. "Allocated") — drives the Home sections. */
  statusDetail: z.string().max(100).optional(),
  /** OnKey staff code of the assignee (demo alias accounts resolve to this). */
  staffCode: z.string().max(64).optional(),
  scheduledDate: isoDate.optional(),
});

/** The full seed bundle a provider returns for one work order. */
export const workOrderBundleSchema = z.object({
  workOrder: workOrderSeedSchema,
  site: siteSeedSchema,
  dispensers: z.array(dispenserSeedSchema).default([]),
});

export type TechnicianSeed = z.infer<typeof technicianSeedSchema>;
export type SiteSeed = z.infer<typeof siteSeedSchema>;
export type DispenserSeed = z.infer<typeof dispenserSeedSchema>;
export type WorkOrderSeed = z.infer<typeof workOrderSeedSchema>;
export type WorkOrderBundle = z.infer<typeof workOrderBundleSchema>;

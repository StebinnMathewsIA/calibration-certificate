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
export declare const workOrderStatusSchema: z.ZodEnum<["open", "in_progress", "completed"]>;
export type WorkOrderStatus = z.infer<typeof workOrderStatusSchema>;
/** A technician resource in OnKey. The sign-in email is the join key that
 * drives which work orders they see. */
export declare const technicianSeedSchema: z.ZodObject<{
    email: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    email: string;
    name?: string | undefined;
}, {
    email: string;
    name?: string | undefined;
}>;
/** Site / customer identity. Every field except `id` may be blank in OnKey —
 * "Oil Company" and "Name (User)" on the certificate. */
export declare const siteSeedSchema: z.ZodObject<{
    id: z.ZodString;
    /** Oil Company, e.g. "Engen", "Shell". */
    customerName: z.ZodOptional<z.ZodString>;
    /** Name (User) — the site/depot name, e.g. "North Road Fuel Depot". */
    siteName: z.ZodOptional<z.ZodString>;
    address: z.ZodOptional<z.ZodString>;
    telephone: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    customerName?: string | undefined;
    siteName?: string | undefined;
    address?: string | undefined;
    telephone?: string | undefined;
}, {
    id: string;
    customerName?: string | undefined;
    siteName?: string | undefined;
    address?: string | undefined;
    telephone?: string | undefined;
}>;
/** A dispenser asset. OnKey stops at this level of granularity; identity may
 * be blank and is completed by the technician. Nothing below the dispenser
 * (pumps/hoses/components) exists in OnKey. */
export declare const dispenserSeedSchema: z.ZodObject<{
    id: z.ZodString;
    siteId: z.ZodString;
    make: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    serialNumber: z.ZodOptional<z.ZodString>;
    /** NRCS type/SA approval number of the dispenser. */
    saApprovalNumber: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    siteId: string;
    model?: string | undefined;
    make?: string | undefined;
    serialNumber?: string | undefined;
    saApprovalNumber?: string | undefined;
}, {
    id: string;
    siteId: string;
    model?: string | undefined;
    make?: string | undefined;
    serialNumber?: string | undefined;
    saApprovalNumber?: string | undefined;
}>;
/** A work order = one site visit. 1 WO = one site; the technician picks which
 * of the WO's dispensers to verify (one certificate per dispenser). */
export declare const workOrderSeedSchema: z.ZodObject<{
    id: z.ZodString;
    /** Human-facing WO reference, e.g. "WO-4711". */
    reference: z.ZodString;
    assignedTechnicianEmail: z.ZodString;
    siteId: z.ZodString;
    dispenserIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    status: z.ZodDefault<z.ZodEnum<["open", "in_progress", "completed"]>>;
    /** Raw OnKey queue status (e.g. "Allocated") — drives the Home sections. */
    statusDetail: z.ZodOptional<z.ZodString>;
    /** OnKey staff code of the assignee (demo alias accounts resolve to this). */
    staffCode: z.ZodOptional<z.ZodString>;
    scheduledDate: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "open" | "in_progress" | "completed";
    id: string;
    siteId: string;
    reference: string;
    assignedTechnicianEmail: string;
    dispenserIds: string[];
    statusDetail?: string | undefined;
    staffCode?: string | undefined;
    scheduledDate?: string | undefined;
}, {
    id: string;
    siteId: string;
    reference: string;
    assignedTechnicianEmail: string;
    status?: "open" | "in_progress" | "completed" | undefined;
    dispenserIds?: string[] | undefined;
    statusDetail?: string | undefined;
    staffCode?: string | undefined;
    scheduledDate?: string | undefined;
}>;
/** The full seed bundle a provider returns for one work order. */
export declare const workOrderBundleSchema: z.ZodObject<{
    workOrder: z.ZodObject<{
        id: z.ZodString;
        /** Human-facing WO reference, e.g. "WO-4711". */
        reference: z.ZodString;
        assignedTechnicianEmail: z.ZodString;
        siteId: z.ZodString;
        dispenserIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        status: z.ZodDefault<z.ZodEnum<["open", "in_progress", "completed"]>>;
        /** Raw OnKey queue status (e.g. "Allocated") — drives the Home sections. */
        statusDetail: z.ZodOptional<z.ZodString>;
        /** OnKey staff code of the assignee (demo alias accounts resolve to this). */
        staffCode: z.ZodOptional<z.ZodString>;
        scheduledDate: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        status: "open" | "in_progress" | "completed";
        id: string;
        siteId: string;
        reference: string;
        assignedTechnicianEmail: string;
        dispenserIds: string[];
        statusDetail?: string | undefined;
        staffCode?: string | undefined;
        scheduledDate?: string | undefined;
    }, {
        id: string;
        siteId: string;
        reference: string;
        assignedTechnicianEmail: string;
        status?: "open" | "in_progress" | "completed" | undefined;
        dispenserIds?: string[] | undefined;
        statusDetail?: string | undefined;
        staffCode?: string | undefined;
        scheduledDate?: string | undefined;
    }>;
    site: z.ZodObject<{
        id: z.ZodString;
        /** Oil Company, e.g. "Engen", "Shell". */
        customerName: z.ZodOptional<z.ZodString>;
        /** Name (User) — the site/depot name, e.g. "North Road Fuel Depot". */
        siteName: z.ZodOptional<z.ZodString>;
        address: z.ZodOptional<z.ZodString>;
        telephone: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        customerName?: string | undefined;
        siteName?: string | undefined;
        address?: string | undefined;
        telephone?: string | undefined;
    }, {
        id: string;
        customerName?: string | undefined;
        siteName?: string | undefined;
        address?: string | undefined;
        telephone?: string | undefined;
    }>;
    dispensers: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        siteId: z.ZodString;
        make: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        serialNumber: z.ZodOptional<z.ZodString>;
        /** NRCS type/SA approval number of the dispenser. */
        saApprovalNumber: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        siteId: string;
        model?: string | undefined;
        make?: string | undefined;
        serialNumber?: string | undefined;
        saApprovalNumber?: string | undefined;
    }, {
        id: string;
        siteId: string;
        model?: string | undefined;
        make?: string | undefined;
        serialNumber?: string | undefined;
        saApprovalNumber?: string | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    site: {
        id: string;
        customerName?: string | undefined;
        siteName?: string | undefined;
        address?: string | undefined;
        telephone?: string | undefined;
    };
    workOrder: {
        status: "open" | "in_progress" | "completed";
        id: string;
        siteId: string;
        reference: string;
        assignedTechnicianEmail: string;
        dispenserIds: string[];
        statusDetail?: string | undefined;
        staffCode?: string | undefined;
        scheduledDate?: string | undefined;
    };
    dispensers: {
        id: string;
        siteId: string;
        model?: string | undefined;
        make?: string | undefined;
        serialNumber?: string | undefined;
        saApprovalNumber?: string | undefined;
    }[];
}, {
    site: {
        id: string;
        customerName?: string | undefined;
        siteName?: string | undefined;
        address?: string | undefined;
        telephone?: string | undefined;
    };
    workOrder: {
        id: string;
        siteId: string;
        reference: string;
        assignedTechnicianEmail: string;
        status?: "open" | "in_progress" | "completed" | undefined;
        dispenserIds?: string[] | undefined;
        statusDetail?: string | undefined;
        staffCode?: string | undefined;
        scheduledDate?: string | undefined;
    };
    dispensers?: {
        id: string;
        siteId: string;
        model?: string | undefined;
        make?: string | undefined;
        serialNumber?: string | undefined;
        saApprovalNumber?: string | undefined;
    }[] | undefined;
}>;
export type TechnicianSeed = z.infer<typeof technicianSeedSchema>;
export type SiteSeed = z.infer<typeof siteSeedSchema>;
export type DispenserSeed = z.infer<typeof dispenserSeedSchema>;
export type WorkOrderSeed = z.infer<typeof workOrderSeedSchema>;
export type WorkOrderBundle = z.infer<typeof workOrderBundleSchema>;

import { z } from 'zod';
export declare const REJECTION_SCHEMA_VERSION = 1;
export declare const rejectedHoseSchema: z.ZodObject<{
    hoseNumber: z.ZodString;
    product: z.ZodString;
    /** Why the hose was rejected: derived from the failed evidence, plus any
     * VO additions. At least one reason is mandatory. */
    reasons: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    hoseNumber: string;
    product: string;
    reasons: string[];
}, {
    hoseNumber: string;
    product: string;
    reasons: string[];
}>;
export declare const rejectionCertificateSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    /** Rejection certificate number (placeholder scheme: parent + '-REJ'). */
    rejectionNumber: z.ZodString;
    /** The issued verification certificate this rejection arises from. */
    parentCertificateNumber: z.ZodString;
    /** Canonical site id — indexes the document into site history. */
    siteId: z.ZodString;
    site: z.ZodObject<{
        customerName: z.ZodString;
        siteName: z.ZodString;
        address: z.ZodString;
        telephone: z.ZodOptional<z.ZodString>;
        contactPerson: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        customerName: string;
        siteName: string;
        address: string;
        telephone?: string | undefined;
        contactPerson?: string | undefined;
    }, {
        customerName: string;
        siteName: string;
        address: string;
        telephone?: string | undefined;
        contactPerson?: string | undefined;
    }>;
    dispenser: z.ZodObject<{
        dispenserId: z.ZodString;
        makeModel: z.ZodString;
        saApprovalNumber: z.ZodString;
        serialNumber: z.ZodString;
        securitySealNumber: z.ZodOptional<z.ZodString>;
        tacNumber: z.ZodOptional<z.ZodString>;
        approvalBasis: z.ZodOptional<z.ZodEnum<["SABS 1650", "LM R117"]>>;
        mmqLitres: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        serialNumber: string;
        saApprovalNumber: string;
        dispenserId: string;
        makeModel: string;
        tacNumber?: string | undefined;
        approvalBasis?: "SABS 1650" | "LM R117" | undefined;
        mmqLitres?: number | undefined;
        securitySealNumber?: string | undefined;
    }, {
        serialNumber: string;
        saApprovalNumber: string;
        dispenserId: string;
        makeModel: string;
        tacNumber?: string | undefined;
        approvalBasis?: "SABS 1650" | "LM R117" | undefined;
        mmqLitres?: number | undefined;
        securitySealNumber?: string | undefined;
    }>;
    rejectedHoses: z.ZodArray<z.ZodObject<{
        hoseNumber: z.ZodString;
        product: z.ZodString;
        /** Why the hose was rejected: derived from the failed evidence, plus any
         * VO additions. At least one reason is mandatory. */
        reasons: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        hoseNumber: string;
        product: string;
        reasons: string[];
    }, {
        hoseNumber: string;
        product: string;
        reasons: string[];
    }>, "many">;
    /** PROC02 5.5 physical steps, confirmed by the VO before sealing. */
    confirmations: z.ZodObject<{
        marksObliterated: z.ZodLiteral<true>;
        rejectionMarkApplied: z.ZodLiteral<true>;
        nozzleSwitchRemoved: z.ZodLiteral<true>;
    }, "strip", z.ZodTypeAny, {
        marksObliterated: true;
        rejectionMarkApplied: true;
        nozzleSwitchRemoved: true;
    }, {
        marksObliterated: true;
        rejectionMarkApplied: true;
        nozzleSwitchRemoved: true;
    }>;
    vo: z.ZodObject<{
        identity: z.ZodObject<{
            subject: z.ZodString;
            name: z.ZodString;
            authMethod: z.ZodEnum<["microsoft", "google", "apple"]>;
        }, "strip", z.ZodTypeAny, {
            subject: string;
            name: string;
            authMethod: "microsoft" | "google" | "apple";
        }, {
            subject: string;
            name: string;
            authMethod: "microsoft" | "google" | "apple";
        }>;
        pliersNumber: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        identity: {
            subject: string;
            name: string;
            authMethod: "microsoft" | "google" | "apple";
        };
        pliersNumber: string;
    }, {
        identity: {
            subject: string;
            name: string;
            authMethod: "microsoft" | "google" | "apple";
        };
        pliersNumber: string;
    }>;
    rejectionDate: z.ZodString;
}, "strip", z.ZodTypeAny, {
    siteId: string;
    vo: {
        identity: {
            subject: string;
            name: string;
            authMethod: "microsoft" | "google" | "apple";
        };
        pliersNumber: string;
    };
    schemaVersion: 1;
    site: {
        customerName: string;
        siteName: string;
        address: string;
        telephone?: string | undefined;
        contactPerson?: string | undefined;
    };
    dispenser: {
        serialNumber: string;
        saApprovalNumber: string;
        dispenserId: string;
        makeModel: string;
        tacNumber?: string | undefined;
        approvalBasis?: "SABS 1650" | "LM R117" | undefined;
        mmqLitres?: number | undefined;
        securitySealNumber?: string | undefined;
    };
    rejectionNumber: string;
    parentCertificateNumber: string;
    rejectedHoses: {
        hoseNumber: string;
        product: string;
        reasons: string[];
    }[];
    confirmations: {
        marksObliterated: true;
        rejectionMarkApplied: true;
        nozzleSwitchRemoved: true;
    };
    rejectionDate: string;
}, {
    siteId: string;
    vo: {
        identity: {
            subject: string;
            name: string;
            authMethod: "microsoft" | "google" | "apple";
        };
        pliersNumber: string;
    };
    schemaVersion: 1;
    site: {
        customerName: string;
        siteName: string;
        address: string;
        telephone?: string | undefined;
        contactPerson?: string | undefined;
    };
    dispenser: {
        serialNumber: string;
        saApprovalNumber: string;
        dispenserId: string;
        makeModel: string;
        tacNumber?: string | undefined;
        approvalBasis?: "SABS 1650" | "LM R117" | undefined;
        mmqLitres?: number | undefined;
        securitySealNumber?: string | undefined;
    };
    rejectionNumber: string;
    parentCertificateNumber: string;
    rejectedHoses: {
        hoseNumber: string;
        product: string;
        reasons: string[];
    }[];
    confirmations: {
        marksObliterated: true;
        rejectionMarkApplied: true;
        nozzleSwitchRemoved: true;
    };
    rejectionDate: string;
}>;
export type RejectedHose = z.infer<typeof rejectedHoseSchema>;
export type RejectionCertificate = z.infer<typeof rejectionCertificateSchema>;

import { z } from 'zod';
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
export declare const SCHEMA_VERSION: 2;
/** e.g. PWC-JHB-000123-00 (system certificate number; the pre-printed NRCS
 * booklet number is captured separately as `nrcsBookNumber`). */
export declare const certificateNumberSchema: z.ZodString;
/** Field provenance — records where a value came from (OnKey seed vs manual)
 * for the audit trail. */
export declare const fieldSourceSchema: z.ZodEnum<["manual", "onkey"]>;
export declare const provenanceEntrySchema: z.ZodObject<{
    prefilled: z.ZodBoolean;
    source: z.ZodEnum<["manual", "onkey"]>;
    /** true if a technician edited a prefilled value — logged as a discrepancy */
    overridden: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    source: "onkey" | "manual";
    prefilled: boolean;
    overridden?: boolean | undefined;
}, {
    source: "onkey" | "manual";
    prefilled: boolean;
    overridden?: boolean | undefined;
}>;
/** Site/customer identity snapshotted onto the certificate. */
export declare const verificationSiteSchema: z.ZodObject<{
    /** Oil Company. */
    customerName: z.ZodString;
    /** Name (User) — site/depot name. */
    siteName: z.ZodString;
    address: z.ZodString;
    telephone: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    customerName: string;
    siteName: string;
    address: string;
    telephone?: string | undefined;
}, {
    customerName: string;
    siteName: string;
    address: string;
    telephone?: string | undefined;
}>;
/** Dispenser (LFD) identity snapshotted onto the certificate. */
export declare const verificationDispenserSchema: z.ZodObject<{
    /** Stable internal dispenser ID (from OnKey seed or manually added). */
    dispenserId: z.ZodString;
    /** "Make & Model". */
    makeModel: z.ZodString;
    saApprovalNumber: z.ZodString;
    serialNumber: z.ZodString;
    /** Dispenser-level "Security Seal No.". */
    securitySealNumber: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    serialNumber: string;
    saApprovalNumber: string;
    dispenserId: string;
    makeModel: string;
    securitySealNumber?: string | undefined;
}, {
    serialNumber: string;
    saApprovalNumber: string;
    dispenserId: string;
    makeModel: string;
    securitySealNumber?: string | undefined;
}>;
/** A reference proving measure used for the verification (200 / 20 / 5 L).
 * Traceable to the national standard; blocks signing when expired. */
export declare const referenceMeasureSchema: z.ZodObject<{
    size: z.ZodEnum<["200L", "20L", "5L"]>;
    serialNumber: z.ZodString;
    certificateNumber: z.ZodString;
    calibrationDate: z.ZodString;
    /** Signing is blocked if this is before the verification date. */
    expiryDate: z.ZodString;
}, "strip", z.ZodTypeAny, {
    serialNumber: string;
    size: "200L" | "20L" | "5L";
    certificateNumber: string;
    calibrationDate: string;
    expiryDate: string;
}, {
    serialNumber: string;
    size: "200L" | "20L" | "5L";
    certificateNumber: string;
    calibrationDate: string;
    expiryDate: string;
}>;
/** Outcome of each circled Pass/Fail checklist item. */
export declare const checklistOutcomeSchema: z.ZodEnum<["pass", "fail", "na"]>;
/** The pass/fail checklist performed per hose on the Metrologist Note. */
export declare const checklistSchema: z.ZodObject<{
    constructionMarking: z.ZodEnum<["pass", "fail", "na"]>;
    computerComputation: z.ZodEnum<["pass", "fail", "na"]>;
    hydraulics: z.ZodEnum<["pass", "fail", "na"]>;
    interlockingDevices: z.ZodEnum<["pass", "fail", "na"]>;
    hoseNozzleAutoStop: z.ZodEnum<["pass", "fail", "na"]>;
    solenoidValveTest: z.ZodEnum<["pass", "fail", "na"]>;
    presetTest: z.ZodEnum<["pass", "fail", "na"]>;
    measuresConformSans1698: z.ZodEnum<["pass", "fail", "na"]>;
    timeOut: z.ZodEnum<["pass", "fail", "na"]>;
    /** Nozzle burst / hose dilation — pressed for 30 s. */
    nozzleBurst: z.ZodEnum<["pass", "fail", "na"]>;
    /** Advance of indication (zero setting). */
    zeroSetting: z.ZodEnum<["pass", "fail", "na"]>;
}, "strip", z.ZodTypeAny, {
    constructionMarking: "pass" | "fail" | "na";
    computerComputation: "pass" | "fail" | "na";
    hydraulics: "pass" | "fail" | "na";
    interlockingDevices: "pass" | "fail" | "na";
    hoseNozzleAutoStop: "pass" | "fail" | "na";
    solenoidValveTest: "pass" | "fail" | "na";
    presetTest: "pass" | "fail" | "na";
    measuresConformSans1698: "pass" | "fail" | "na";
    timeOut: "pass" | "fail" | "na";
    nozzleBurst: "pass" | "fail" | "na";
    zeroSetting: "pass" | "fail" | "na";
}, {
    constructionMarking: "pass" | "fail" | "na";
    computerComputation: "pass" | "fail" | "na";
    hydraulics: "pass" | "fail" | "na";
    interlockingDevices: "pass" | "fail" | "na";
    hoseNozzleAutoStop: "pass" | "fail" | "na";
    solenoidValveTest: "pass" | "fail" | "na";
    presetTest: "pass" | "fail" | "na";
    measuresConformSans1698: "pass" | "fail" | "na";
    timeOut: "pass" | "fail" | "na";
    nozzleBurst: "pass" | "fail" | "na";
    zeroSetting: "pass" | "fail" | "na";
}>;
/** Per-hose verification/repair status (Verification Status / Repair Status). */
export declare const hoseStatusSchema: z.ZodEnum<["new", "repaired", "atu", "rejected"]>;
/** Test condition of the product at delivery. */
export declare const testConditionSchema: z.ZodEnum<["hot", "cold"]>;
/** One EFD delivery: the dispenser vs the reference measure at a flow rate. */
export declare const deliverySchema: z.ZodObject<{
    point: z.ZodEnum<["del1_max", "del2_max", "del3_max", "min_flow", "preset"]>;
    flowRateLpm: z.ZodNumber;
    /** VFD — volume indicated by the dispenser. */
    vfdMl: z.ZodNumber;
    /** VREF — volume indicated by the reference measure. */
    vrefMl: z.ZodNumber;
    /** EFD = (VFD − VREF)/VREF × 100 — computed client-side, verified server-side. */
    efdPercent: z.ZodNumber;
    pass: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    pass: boolean;
    point: "del1_max" | "del2_max" | "del3_max" | "min_flow" | "preset";
    flowRateLpm: number;
    vfdMl: number;
    vrefMl: number;
    efdPercent: number;
}, {
    pass: boolean;
    point: "del1_max" | "del2_max" | "del3_max" | "min_flow" | "preset";
    flowRateLpm: number;
    vfdMl: number;
    vrefMl: number;
    efdPercent: number;
}>;
/** Instrument outcome for the hose. */
export declare const hoseOutcomeSchema: z.ZodEnum<["certified", "rejected"]>;
/** All results for one hose/pump. */
export declare const hoseResultSchema: z.ZodObject<{
    /** "Hose/Pump No." */
    hoseNumber: z.ZodString;
    product: z.ZodString;
    status: z.ZodEnum<["new", "repaired", "atu", "rejected"]>;
    /** Component identity snapshot (meter/PC board/pulsar/solenoid). */
    components: z.ZodObject<{
        meter: z.ZodObject<{
            make: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
            serial: z.ZodOptional<z.ZodString>;
            saApproval: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        }, {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        }>;
        pcBoard: z.ZodObject<{
            make: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
            serial: z.ZodOptional<z.ZodString>;
            saApproval: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        }, {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        }>;
        pulsar: z.ZodObject<{
            make: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
            serial: z.ZodOptional<z.ZodString>;
            saApproval: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        }, {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        }>;
        solenoid: z.ZodObject<{
            make: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
            serial: z.ZodOptional<z.ZodString>;
            saApproval: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        }, {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        meter: {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        };
        pcBoard: {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        };
        pulsar: {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        };
        solenoid: {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        };
    }, {
        meter: {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        };
        pcBoard: {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        };
        pulsar: {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        };
        solenoid: {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        };
    }>;
    securitySeal: z.ZodOptional<z.ZodString>;
    totalizerBefore: z.ZodOptional<z.ZodNumber>;
    totalizerAfter: z.ZodOptional<z.ZodNumber>;
    quantityDelivered: z.ZodOptional<z.ZodNumber>;
    testCondition: z.ZodEnum<["hot", "cold"]>;
    /** Data-plate flow range (L/min). */
    qMinLpm: z.ZodOptional<z.ZodNumber>;
    qMaxLpm: z.ZodOptional<z.ZodNumber>;
    checklist: z.ZodObject<{
        constructionMarking: z.ZodEnum<["pass", "fail", "na"]>;
        computerComputation: z.ZodEnum<["pass", "fail", "na"]>;
        hydraulics: z.ZodEnum<["pass", "fail", "na"]>;
        interlockingDevices: z.ZodEnum<["pass", "fail", "na"]>;
        hoseNozzleAutoStop: z.ZodEnum<["pass", "fail", "na"]>;
        solenoidValveTest: z.ZodEnum<["pass", "fail", "na"]>;
        presetTest: z.ZodEnum<["pass", "fail", "na"]>;
        measuresConformSans1698: z.ZodEnum<["pass", "fail", "na"]>;
        timeOut: z.ZodEnum<["pass", "fail", "na"]>;
        /** Nozzle burst / hose dilation — pressed for 30 s. */
        nozzleBurst: z.ZodEnum<["pass", "fail", "na"]>;
        /** Advance of indication (zero setting). */
        zeroSetting: z.ZodEnum<["pass", "fail", "na"]>;
    }, "strip", z.ZodTypeAny, {
        constructionMarking: "pass" | "fail" | "na";
        computerComputation: "pass" | "fail" | "na";
        hydraulics: "pass" | "fail" | "na";
        interlockingDevices: "pass" | "fail" | "na";
        hoseNozzleAutoStop: "pass" | "fail" | "na";
        solenoidValveTest: "pass" | "fail" | "na";
        presetTest: "pass" | "fail" | "na";
        measuresConformSans1698: "pass" | "fail" | "na";
        timeOut: "pass" | "fail" | "na";
        nozzleBurst: "pass" | "fail" | "na";
        zeroSetting: "pass" | "fail" | "na";
    }, {
        constructionMarking: "pass" | "fail" | "na";
        computerComputation: "pass" | "fail" | "na";
        hydraulics: "pass" | "fail" | "na";
        interlockingDevices: "pass" | "fail" | "na";
        hoseNozzleAutoStop: "pass" | "fail" | "na";
        solenoidValveTest: "pass" | "fail" | "na";
        presetTest: "pass" | "fail" | "na";
        measuresConformSans1698: "pass" | "fail" | "na";
        timeOut: "pass" | "fail" | "na";
        nozzleBurst: "pass" | "fail" | "na";
        zeroSetting: "pass" | "fail" | "na";
    }>;
    deliveries: z.ZodArray<z.ZodObject<{
        point: z.ZodEnum<["del1_max", "del2_max", "del3_max", "min_flow", "preset"]>;
        flowRateLpm: z.ZodNumber;
        /** VFD — volume indicated by the dispenser. */
        vfdMl: z.ZodNumber;
        /** VREF — volume indicated by the reference measure. */
        vrefMl: z.ZodNumber;
        /** EFD = (VFD − VREF)/VREF × 100 — computed client-side, verified server-side. */
        efdPercent: z.ZodNumber;
        pass: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        pass: boolean;
        point: "del1_max" | "del2_max" | "del3_max" | "min_flow" | "preset";
        flowRateLpm: number;
        vfdMl: number;
        vrefMl: number;
        efdPercent: number;
    }, {
        pass: boolean;
        point: "del1_max" | "del2_max" | "del3_max" | "min_flow" | "preset";
        flowRateLpm: number;
        vfdMl: number;
        vrefMl: number;
        efdPercent: number;
    }>, "many">;
    outcome: z.ZodEnum<["certified", "rejected"]>;
    comments: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "new" | "repaired" | "atu" | "rejected";
    hoseNumber: string;
    product: string;
    components: {
        meter: {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        };
        pcBoard: {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        };
        pulsar: {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        };
        solenoid: {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        };
    };
    testCondition: "hot" | "cold";
    checklist: {
        constructionMarking: "pass" | "fail" | "na";
        computerComputation: "pass" | "fail" | "na";
        hydraulics: "pass" | "fail" | "na";
        interlockingDevices: "pass" | "fail" | "na";
        hoseNozzleAutoStop: "pass" | "fail" | "na";
        solenoidValveTest: "pass" | "fail" | "na";
        presetTest: "pass" | "fail" | "na";
        measuresConformSans1698: "pass" | "fail" | "na";
        timeOut: "pass" | "fail" | "na";
        nozzleBurst: "pass" | "fail" | "na";
        zeroSetting: "pass" | "fail" | "na";
    };
    deliveries: {
        pass: boolean;
        point: "del1_max" | "del2_max" | "del3_max" | "min_flow" | "preset";
        flowRateLpm: number;
        vfdMl: number;
        vrefMl: number;
        efdPercent: number;
    }[];
    outcome: "rejected" | "certified";
    securitySeal?: string | undefined;
    qMinLpm?: number | undefined;
    qMaxLpm?: number | undefined;
    totalizerBefore?: number | undefined;
    totalizerAfter?: number | undefined;
    quantityDelivered?: number | undefined;
    comments?: string | undefined;
}, {
    status: "new" | "repaired" | "atu" | "rejected";
    hoseNumber: string;
    product: string;
    components: {
        meter: {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        };
        pcBoard: {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        };
        pulsar: {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        };
        solenoid: {
            model?: string | undefined;
            make?: string | undefined;
            serial?: string | undefined;
            saApproval?: string | undefined;
        };
    };
    testCondition: "hot" | "cold";
    checklist: {
        constructionMarking: "pass" | "fail" | "na";
        computerComputation: "pass" | "fail" | "na";
        hydraulics: "pass" | "fail" | "na";
        interlockingDevices: "pass" | "fail" | "na";
        hoseNozzleAutoStop: "pass" | "fail" | "na";
        solenoidValveTest: "pass" | "fail" | "na";
        presetTest: "pass" | "fail" | "na";
        measuresConformSans1698: "pass" | "fail" | "na";
        timeOut: "pass" | "fail" | "na";
        nozzleBurst: "pass" | "fail" | "na";
        zeroSetting: "pass" | "fail" | "na";
    };
    deliveries: {
        pass: boolean;
        point: "del1_max" | "del2_max" | "del3_max" | "min_flow" | "preset";
        flowRateLpm: number;
        vfdMl: number;
        vrefMl: number;
        efdPercent: number;
    }[];
    outcome: "rejected" | "certified";
    securitySeal?: string | undefined;
    qMinLpm?: number | undefined;
    qMaxLpm?: number | undefined;
    totalizerBefore?: number | undefined;
    totalizerAfter?: number | undefined;
    quantityDelivered?: number | undefined;
    comments?: string | undefined;
}>;
export declare const authMethodSchema: z.ZodEnum<["microsoft", "google", "apple"]>;
export declare const technicianIdentitySchema: z.ZodObject<{
    /** IdP subject claim (stable identifier). */
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
export declare const signOffSchema: z.ZodObject<{
    /** Verifying Officer = the logged-in technician (cryptographic signatory). */
    vo: z.ZodObject<{
        identity: z.ZodObject<{
            /** IdP subject claim (stable identifier). */
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
        /** VO Pliers No. — the technician's controlled sealing-plier identifier. */
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
    /** Client acknowledgement — a captured handwritten signature (no credentials). */
    client: z.ZodObject<{
        name: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
    }, {
        name: string;
    }>;
    /** "I certify the instrument was tested per the Legal Metrology Act …" */
    declarationAccepted: z.ZodBoolean;
    /** Expiry Date of Certificate. */
    expiryDate: z.ZodOptional<z.ZodString>;
    /** Rejection Cert. No. (if applicable) — present when any hose is rejected. */
    rejectionCertNumber: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    vo: {
        identity: {
            subject: string;
            name: string;
            authMethod: "microsoft" | "google" | "apple";
        };
        pliersNumber: string;
    };
    client: {
        name: string;
    };
    declarationAccepted: boolean;
    expiryDate?: string | undefined;
    rejectionCertNumber?: string | undefined;
}, {
    vo: {
        identity: {
            subject: string;
            name: string;
            authMethod: "microsoft" | "google" | "apple";
        };
        pliersNumber: string;
    };
    client: {
        name: string;
    };
    declarationAccepted: boolean;
    expiryDate?: string | undefined;
    rejectionCertNumber?: string | undefined;
}>;
export declare const reportTypeSchema: z.ZodEnum<["verification", "repair"]>;
export declare const DEFAULT_METHOD_REFERENCE = "SANS Test Proc 01 & SANS Test Proc 02 based on LM-IR 117-2: 2023";
export declare const verificationSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<2>;
    certificateNumber: z.ZodString;
    /** Pre-printed NRCS booklet number, e.g. "139458". */
    nrcsBookNumber: z.ZodOptional<z.ZodString>;
    reportType: z.ZodEnum<["verification", "repair"]>;
    site: z.ZodObject<{
        /** Oil Company. */
        customerName: z.ZodString;
        /** Name (User) — site/depot name. */
        siteName: z.ZodString;
        address: z.ZodString;
        telephone: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        customerName: string;
        siteName: string;
        address: string;
        telephone?: string | undefined;
    }, {
        customerName: string;
        siteName: string;
        address: string;
        telephone?: string | undefined;
    }>;
    /** Job Ref. No. — free text in PoC; the OnKey WO reference in future state. */
    jobReference: z.ZodOptional<z.ZodString>;
    workOrderId: z.ZodOptional<z.ZodString>;
    dispenser: z.ZodObject<{
        /** Stable internal dispenser ID (from OnKey seed or manually added). */
        dispenserId: z.ZodString;
        /** "Make & Model". */
        makeModel: z.ZodString;
        saApprovalNumber: z.ZodString;
        serialNumber: z.ZodString;
        /** Dispenser-level "Security Seal No.". */
        securitySealNumber: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        serialNumber: string;
        saApprovalNumber: string;
        dispenserId: string;
        makeModel: string;
        securitySealNumber?: string | undefined;
    }, {
        serialNumber: string;
        saApprovalNumber: string;
        dispenserId: string;
        makeModel: string;
        securitySealNumber?: string | undefined;
    }>;
    referenceMeasures: z.ZodArray<z.ZodObject<{
        size: z.ZodEnum<["200L", "20L", "5L"]>;
        serialNumber: z.ZodString;
        certificateNumber: z.ZodString;
        calibrationDate: z.ZodString;
        /** Signing is blocked if this is before the verification date. */
        expiryDate: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        serialNumber: string;
        size: "200L" | "20L" | "5L";
        certificateNumber: string;
        calibrationDate: string;
        expiryDate: string;
    }, {
        serialNumber: string;
        size: "200L" | "20L" | "5L";
        certificateNumber: string;
        calibrationDate: string;
        expiryDate: string;
    }>, "many">;
    methodReference: z.ZodString;
    hoses: z.ZodArray<z.ZodObject<{
        /** "Hose/Pump No." */
        hoseNumber: z.ZodString;
        product: z.ZodString;
        status: z.ZodEnum<["new", "repaired", "atu", "rejected"]>;
        /** Component identity snapshot (meter/PC board/pulsar/solenoid). */
        components: z.ZodObject<{
            meter: z.ZodObject<{
                make: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                serial: z.ZodOptional<z.ZodString>;
                saApproval: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            }, {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            }>;
            pcBoard: z.ZodObject<{
                make: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                serial: z.ZodOptional<z.ZodString>;
                saApproval: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            }, {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            }>;
            pulsar: z.ZodObject<{
                make: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                serial: z.ZodOptional<z.ZodString>;
                saApproval: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            }, {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            }>;
            solenoid: z.ZodObject<{
                make: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                serial: z.ZodOptional<z.ZodString>;
                saApproval: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            }, {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            }>;
        }, "strip", z.ZodTypeAny, {
            meter: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
            pcBoard: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
            pulsar: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
            solenoid: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
        }, {
            meter: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
            pcBoard: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
            pulsar: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
            solenoid: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
        }>;
        securitySeal: z.ZodOptional<z.ZodString>;
        totalizerBefore: z.ZodOptional<z.ZodNumber>;
        totalizerAfter: z.ZodOptional<z.ZodNumber>;
        quantityDelivered: z.ZodOptional<z.ZodNumber>;
        testCondition: z.ZodEnum<["hot", "cold"]>;
        /** Data-plate flow range (L/min). */
        qMinLpm: z.ZodOptional<z.ZodNumber>;
        qMaxLpm: z.ZodOptional<z.ZodNumber>;
        checklist: z.ZodObject<{
            constructionMarking: z.ZodEnum<["pass", "fail", "na"]>;
            computerComputation: z.ZodEnum<["pass", "fail", "na"]>;
            hydraulics: z.ZodEnum<["pass", "fail", "na"]>;
            interlockingDevices: z.ZodEnum<["pass", "fail", "na"]>;
            hoseNozzleAutoStop: z.ZodEnum<["pass", "fail", "na"]>;
            solenoidValveTest: z.ZodEnum<["pass", "fail", "na"]>;
            presetTest: z.ZodEnum<["pass", "fail", "na"]>;
            measuresConformSans1698: z.ZodEnum<["pass", "fail", "na"]>;
            timeOut: z.ZodEnum<["pass", "fail", "na"]>;
            /** Nozzle burst / hose dilation — pressed for 30 s. */
            nozzleBurst: z.ZodEnum<["pass", "fail", "na"]>;
            /** Advance of indication (zero setting). */
            zeroSetting: z.ZodEnum<["pass", "fail", "na"]>;
        }, "strip", z.ZodTypeAny, {
            constructionMarking: "pass" | "fail" | "na";
            computerComputation: "pass" | "fail" | "na";
            hydraulics: "pass" | "fail" | "na";
            interlockingDevices: "pass" | "fail" | "na";
            hoseNozzleAutoStop: "pass" | "fail" | "na";
            solenoidValveTest: "pass" | "fail" | "na";
            presetTest: "pass" | "fail" | "na";
            measuresConformSans1698: "pass" | "fail" | "na";
            timeOut: "pass" | "fail" | "na";
            nozzleBurst: "pass" | "fail" | "na";
            zeroSetting: "pass" | "fail" | "na";
        }, {
            constructionMarking: "pass" | "fail" | "na";
            computerComputation: "pass" | "fail" | "na";
            hydraulics: "pass" | "fail" | "na";
            interlockingDevices: "pass" | "fail" | "na";
            hoseNozzleAutoStop: "pass" | "fail" | "na";
            solenoidValveTest: "pass" | "fail" | "na";
            presetTest: "pass" | "fail" | "na";
            measuresConformSans1698: "pass" | "fail" | "na";
            timeOut: "pass" | "fail" | "na";
            nozzleBurst: "pass" | "fail" | "na";
            zeroSetting: "pass" | "fail" | "na";
        }>;
        deliveries: z.ZodArray<z.ZodObject<{
            point: z.ZodEnum<["del1_max", "del2_max", "del3_max", "min_flow", "preset"]>;
            flowRateLpm: z.ZodNumber;
            /** VFD — volume indicated by the dispenser. */
            vfdMl: z.ZodNumber;
            /** VREF — volume indicated by the reference measure. */
            vrefMl: z.ZodNumber;
            /** EFD = (VFD − VREF)/VREF × 100 — computed client-side, verified server-side. */
            efdPercent: z.ZodNumber;
            pass: z.ZodBoolean;
        }, "strip", z.ZodTypeAny, {
            pass: boolean;
            point: "del1_max" | "del2_max" | "del3_max" | "min_flow" | "preset";
            flowRateLpm: number;
            vfdMl: number;
            vrefMl: number;
            efdPercent: number;
        }, {
            pass: boolean;
            point: "del1_max" | "del2_max" | "del3_max" | "min_flow" | "preset";
            flowRateLpm: number;
            vfdMl: number;
            vrefMl: number;
            efdPercent: number;
        }>, "many">;
        outcome: z.ZodEnum<["certified", "rejected"]>;
        comments: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        status: "new" | "repaired" | "atu" | "rejected";
        hoseNumber: string;
        product: string;
        components: {
            meter: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
            pcBoard: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
            pulsar: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
            solenoid: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
        };
        testCondition: "hot" | "cold";
        checklist: {
            constructionMarking: "pass" | "fail" | "na";
            computerComputation: "pass" | "fail" | "na";
            hydraulics: "pass" | "fail" | "na";
            interlockingDevices: "pass" | "fail" | "na";
            hoseNozzleAutoStop: "pass" | "fail" | "na";
            solenoidValveTest: "pass" | "fail" | "na";
            presetTest: "pass" | "fail" | "na";
            measuresConformSans1698: "pass" | "fail" | "na";
            timeOut: "pass" | "fail" | "na";
            nozzleBurst: "pass" | "fail" | "na";
            zeroSetting: "pass" | "fail" | "na";
        };
        deliveries: {
            pass: boolean;
            point: "del1_max" | "del2_max" | "del3_max" | "min_flow" | "preset";
            flowRateLpm: number;
            vfdMl: number;
            vrefMl: number;
            efdPercent: number;
        }[];
        outcome: "rejected" | "certified";
        securitySeal?: string | undefined;
        qMinLpm?: number | undefined;
        qMaxLpm?: number | undefined;
        totalizerBefore?: number | undefined;
        totalizerAfter?: number | undefined;
        quantityDelivered?: number | undefined;
        comments?: string | undefined;
    }, {
        status: "new" | "repaired" | "atu" | "rejected";
        hoseNumber: string;
        product: string;
        components: {
            meter: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
            pcBoard: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
            pulsar: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
            solenoid: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
        };
        testCondition: "hot" | "cold";
        checklist: {
            constructionMarking: "pass" | "fail" | "na";
            computerComputation: "pass" | "fail" | "na";
            hydraulics: "pass" | "fail" | "na";
            interlockingDevices: "pass" | "fail" | "na";
            hoseNozzleAutoStop: "pass" | "fail" | "na";
            solenoidValveTest: "pass" | "fail" | "na";
            presetTest: "pass" | "fail" | "na";
            measuresConformSans1698: "pass" | "fail" | "na";
            timeOut: "pass" | "fail" | "na";
            nozzleBurst: "pass" | "fail" | "na";
            zeroSetting: "pass" | "fail" | "na";
        };
        deliveries: {
            pass: boolean;
            point: "del1_max" | "del2_max" | "del3_max" | "min_flow" | "preset";
            flowRateLpm: number;
            vfdMl: number;
            vrefMl: number;
            efdPercent: number;
        }[];
        outcome: "rejected" | "certified";
        securitySeal?: string | undefined;
        qMinLpm?: number | undefined;
        qMaxLpm?: number | undefined;
        totalizerBefore?: number | undefined;
        totalizerAfter?: number | undefined;
        quantityDelivered?: number | undefined;
        comments?: string | undefined;
    }>, "many">;
    signOff: z.ZodObject<{
        /** Verifying Officer = the logged-in technician (cryptographic signatory). */
        vo: z.ZodObject<{
            identity: z.ZodObject<{
                /** IdP subject claim (stable identifier). */
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
            /** VO Pliers No. — the technician's controlled sealing-plier identifier. */
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
        /** Client acknowledgement — a captured handwritten signature (no credentials). */
        client: z.ZodObject<{
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
        }, {
            name: string;
        }>;
        /** "I certify the instrument was tested per the Legal Metrology Act …" */
        declarationAccepted: z.ZodBoolean;
        /** Expiry Date of Certificate. */
        expiryDate: z.ZodOptional<z.ZodString>;
        /** Rejection Cert. No. (if applicable) — present when any hose is rejected. */
        rejectionCertNumber: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        vo: {
            identity: {
                subject: string;
                name: string;
                authMethod: "microsoft" | "google" | "apple";
            };
            pliersNumber: string;
        };
        client: {
            name: string;
        };
        declarationAccepted: boolean;
        expiryDate?: string | undefined;
        rejectionCertNumber?: string | undefined;
    }, {
        vo: {
            identity: {
                subject: string;
                name: string;
                authMethod: "microsoft" | "google" | "apple";
            };
            pliersNumber: string;
        };
        client: {
            name: string;
        };
        declarationAccepted: boolean;
        expiryDate?: string | undefined;
        rejectionCertNumber?: string | undefined;
    }>;
    /** Verification date (default today). issueDate is set by the backend at
     * signing time (TSA date) and stamped onto the signed PDF. */
    verificationDate: z.ZodString;
    /** Keyed by dotted field path, e.g. "site.customerName". */
    provenance: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        prefilled: z.ZodBoolean;
        source: z.ZodEnum<["manual", "onkey"]>;
        /** true if a technician edited a prefilled value — logged as a discrepancy */
        overridden: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        source: "onkey" | "manual";
        prefilled: boolean;
        overridden?: boolean | undefined;
    }, {
        source: "onkey" | "manual";
        prefilled: boolean;
        overridden?: boolean | undefined;
    }>>>;
}, "strip", z.ZodTypeAny, {
    hoses: {
        status: "new" | "repaired" | "atu" | "rejected";
        hoseNumber: string;
        product: string;
        components: {
            meter: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
            pcBoard: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
            pulsar: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
            solenoid: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
        };
        testCondition: "hot" | "cold";
        checklist: {
            constructionMarking: "pass" | "fail" | "na";
            computerComputation: "pass" | "fail" | "na";
            hydraulics: "pass" | "fail" | "na";
            interlockingDevices: "pass" | "fail" | "na";
            hoseNozzleAutoStop: "pass" | "fail" | "na";
            solenoidValveTest: "pass" | "fail" | "na";
            presetTest: "pass" | "fail" | "na";
            measuresConformSans1698: "pass" | "fail" | "na";
            timeOut: "pass" | "fail" | "na";
            nozzleBurst: "pass" | "fail" | "na";
            zeroSetting: "pass" | "fail" | "na";
        };
        deliveries: {
            pass: boolean;
            point: "del1_max" | "del2_max" | "del3_max" | "min_flow" | "preset";
            flowRateLpm: number;
            vfdMl: number;
            vrefMl: number;
            efdPercent: number;
        }[];
        outcome: "rejected" | "certified";
        securitySeal?: string | undefined;
        qMinLpm?: number | undefined;
        qMaxLpm?: number | undefined;
        totalizerBefore?: number | undefined;
        totalizerAfter?: number | undefined;
        quantityDelivered?: number | undefined;
        comments?: string | undefined;
    }[];
    certificateNumber: string;
    schemaVersion: 2;
    reportType: "verification" | "repair";
    site: {
        customerName: string;
        siteName: string;
        address: string;
        telephone?: string | undefined;
    };
    dispenser: {
        serialNumber: string;
        saApprovalNumber: string;
        dispenserId: string;
        makeModel: string;
        securitySealNumber?: string | undefined;
    };
    referenceMeasures: {
        serialNumber: string;
        size: "200L" | "20L" | "5L";
        certificateNumber: string;
        calibrationDate: string;
        expiryDate: string;
    }[];
    methodReference: string;
    signOff: {
        vo: {
            identity: {
                subject: string;
                name: string;
                authMethod: "microsoft" | "google" | "apple";
            };
            pliersNumber: string;
        };
        client: {
            name: string;
        };
        declarationAccepted: boolean;
        expiryDate?: string | undefined;
        rejectionCertNumber?: string | undefined;
    };
    verificationDate: string;
    nrcsBookNumber?: string | undefined;
    jobReference?: string | undefined;
    workOrderId?: string | undefined;
    provenance?: Record<string, {
        source: "onkey" | "manual";
        prefilled: boolean;
        overridden?: boolean | undefined;
    }> | undefined;
}, {
    hoses: {
        status: "new" | "repaired" | "atu" | "rejected";
        hoseNumber: string;
        product: string;
        components: {
            meter: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
            pcBoard: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
            pulsar: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
            solenoid: {
                model?: string | undefined;
                make?: string | undefined;
                serial?: string | undefined;
                saApproval?: string | undefined;
            };
        };
        testCondition: "hot" | "cold";
        checklist: {
            constructionMarking: "pass" | "fail" | "na";
            computerComputation: "pass" | "fail" | "na";
            hydraulics: "pass" | "fail" | "na";
            interlockingDevices: "pass" | "fail" | "na";
            hoseNozzleAutoStop: "pass" | "fail" | "na";
            solenoidValveTest: "pass" | "fail" | "na";
            presetTest: "pass" | "fail" | "na";
            measuresConformSans1698: "pass" | "fail" | "na";
            timeOut: "pass" | "fail" | "na";
            nozzleBurst: "pass" | "fail" | "na";
            zeroSetting: "pass" | "fail" | "na";
        };
        deliveries: {
            pass: boolean;
            point: "del1_max" | "del2_max" | "del3_max" | "min_flow" | "preset";
            flowRateLpm: number;
            vfdMl: number;
            vrefMl: number;
            efdPercent: number;
        }[];
        outcome: "rejected" | "certified";
        securitySeal?: string | undefined;
        qMinLpm?: number | undefined;
        qMaxLpm?: number | undefined;
        totalizerBefore?: number | undefined;
        totalizerAfter?: number | undefined;
        quantityDelivered?: number | undefined;
        comments?: string | undefined;
    }[];
    certificateNumber: string;
    schemaVersion: 2;
    reportType: "verification" | "repair";
    site: {
        customerName: string;
        siteName: string;
        address: string;
        telephone?: string | undefined;
    };
    dispenser: {
        serialNumber: string;
        saApprovalNumber: string;
        dispenserId: string;
        makeModel: string;
        securitySealNumber?: string | undefined;
    };
    referenceMeasures: {
        serialNumber: string;
        size: "200L" | "20L" | "5L";
        certificateNumber: string;
        calibrationDate: string;
        expiryDate: string;
    }[];
    methodReference: string;
    signOff: {
        vo: {
            identity: {
                subject: string;
                name: string;
                authMethod: "microsoft" | "google" | "apple";
            };
            pliersNumber: string;
        };
        client: {
            name: string;
        };
        declarationAccepted: boolean;
        expiryDate?: string | undefined;
        rejectionCertNumber?: string | undefined;
    };
    verificationDate: string;
    nrcsBookNumber?: string | undefined;
    jobReference?: string | undefined;
    workOrderId?: string | undefined;
    provenance?: Record<string, {
        source: "onkey" | "manual";
        prefilled: boolean;
        overridden?: boolean | undefined;
    }> | undefined;
}>;
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
export declare const CHECKLIST_ITEMS: {
    key: keyof Checklist;
    label: string;
}[];

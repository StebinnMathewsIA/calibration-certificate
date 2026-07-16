import { z } from 'zod';
/** Where a canonical record's identity originated. */
export declare const recordSourceSchema: z.ZodEnum<["onkey", "manual"]>;
export type RecordSource = z.infer<typeof recordSourceSchema>;
/** A dispenser can be retired (soft) but never hard-deleted — issued
 * verifications stay immutable and the history is preserved for the audit. */
export declare const dispenserStatusSchema: z.ZodEnum<["active", "retired"]>;
export type DispenserStatus = z.infer<typeof dispenserStatusSchema>;
export declare const siteRecordSchema: z.ZodObject<{
    id: z.ZodString;
    /** Oil Company. */
    customerName: z.ZodString;
    /** Name (User) — site/depot name. */
    siteName: z.ZodString;
    address: z.ZodString;
    telephone: z.ZodOptional<z.ZodString>;
    source: z.ZodEnum<["onkey", "manual"]>;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    customerName: string;
    siteName: string;
    address: string;
    source: "onkey" | "manual";
    updatedAt: string;
    telephone?: string | undefined;
}, {
    id: string;
    customerName: string;
    siteName: string;
    address: string;
    source: "onkey" | "manual";
    updatedAt: string;
    telephone?: string | undefined;
}>;
export type SiteRecord = z.infer<typeof siteRecordSchema>;
export declare const dispenserRecordSchema: z.ZodObject<{
    id: z.ZodString;
    siteId: z.ZodString;
    make: z.ZodString;
    model: z.ZodString;
    serialNumber: z.ZodString;
    saApprovalNumber: z.ZodString;
    status: z.ZodEnum<["active", "retired"]>;
    source: z.ZodEnum<["onkey", "manual"]>;
    addedBy: z.ZodOptional<z.ZodString>;
    addedAt: z.ZodOptional<z.ZodString>;
    retiredBy: z.ZodOptional<z.ZodString>;
    retiredAt: z.ZodOptional<z.ZodString>;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "active" | "retired";
    model: string;
    id: string;
    source: "onkey" | "manual";
    updatedAt: string;
    siteId: string;
    make: string;
    serialNumber: string;
    saApprovalNumber: string;
    addedBy?: string | undefined;
    addedAt?: string | undefined;
    retiredBy?: string | undefined;
    retiredAt?: string | undefined;
}, {
    status: "active" | "retired";
    model: string;
    id: string;
    source: "onkey" | "manual";
    updatedAt: string;
    siteId: string;
    make: string;
    serialNumber: string;
    saApprovalNumber: string;
    addedBy?: string | undefined;
    addedAt?: string | undefined;
    retiredBy?: string | undefined;
    retiredAt?: string | undefined;
}>;
export type DispenserRecord = z.infer<typeof dispenserRecordSchema>;
/** One physical component (meter / PC board / pulsar / solenoid valve).
 * Identity may be partially unknown on first capture. */
export declare const componentSchema: z.ZodObject<{
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
export type Component = z.infer<typeof componentSchema>;
/** The four components verified per hose on the NRCS certificate. */
export declare const hoseComponentsSchema: z.ZodObject<{
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
export type HoseComponents = z.infer<typeof hoseComponentsSchema>;
/** A hose/pump on the dispenser: its product and its four components. */
export declare const hoseDetailSchema: z.ZodObject<{
    /** "Hose/Pump No." on the certificate. */
    hoseNumber: z.ZodString;
    /** Fuel grade delivered, e.g. "ULP 95", "Diesel 50ppm". */
    product: z.ZodString;
    securitySeal: z.ZodOptional<z.ZodString>;
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
}, "strip", z.ZodTypeAny, {
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
    securitySeal?: string | undefined;
}, {
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
    securitySeal?: string | undefined;
}>;
export type HoseDetail = z.infer<typeof hoseDetailSchema>;
/** The full per-dispenser register: data-plate flow range + all hoses.
 * Entered once, saved against the dispenser, prefilled next verification. */
export declare const dispenserDetailSchema: z.ZodObject<{
    dispenserId: z.ZodString;
    /** Data-plate minimum flow rate (L/min). */
    qMinLpm: z.ZodOptional<z.ZodNumber>;
    /** Data-plate maximum flow rate (L/min). */
    qMaxLpm: z.ZodOptional<z.ZodNumber>;
    hoses: z.ZodDefault<z.ZodArray<z.ZodObject<{
        /** "Hose/Pump No." on the certificate. */
        hoseNumber: z.ZodString;
        /** Fuel grade delivered, e.g. "ULP 95", "Diesel 50ppm". */
        product: z.ZodString;
        securitySeal: z.ZodOptional<z.ZodString>;
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
    }, "strip", z.ZodTypeAny, {
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
        securitySeal?: string | undefined;
    }, {
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
        securitySeal?: string | undefined;
    }>, "many">>;
    updatedAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    dispenserId: string;
    hoses: {
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
        securitySeal?: string | undefined;
    }[];
    updatedAt?: string | undefined;
    qMinLpm?: number | undefined;
    qMaxLpm?: number | undefined;
}, {
    dispenserId: string;
    updatedAt?: string | undefined;
    qMinLpm?: number | undefined;
    qMaxLpm?: number | undefined;
    hoses?: {
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
        securitySeal?: string | undefined;
    }[] | undefined;
}>;
export type DispenserDetail = z.infer<typeof dispenserDetailSchema>;

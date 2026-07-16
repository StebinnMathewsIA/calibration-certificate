import { z } from 'zod';
export declare const gpsFixSchema: z.ZodObject<{
    latitude: z.ZodNumber;
    longitude: z.ZodNumber;
    accuracyM: z.ZodNumber;
    /** POPIA: GPS is only captured with explicit consent. */
    consentGiven: z.ZodLiteral<true>;
}, "strip", z.ZodTypeAny, {
    latitude: number;
    longitude: number;
    accuracyM: number;
    consentGiven: true;
}, {
    latitude: number;
    longitude: number;
    accuracyM: number;
    consentGiven: true;
}>;
export declare const intentToSignSchema: z.ZodObject<{
    /** Device clock at the moment the technician passed the biometric prompt. */
    deviceTimestamp: z.ZodString;
    deviceId: z.ZodString;
    gps: z.ZodOptional<z.ZodObject<{
        latitude: z.ZodNumber;
        longitude: z.ZodNumber;
        accuracyM: z.ZodNumber;
        /** POPIA: GPS is only captured with explicit consent. */
        consentGiven: z.ZodLiteral<true>;
    }, "strip", z.ZodTypeAny, {
        latitude: number;
        longitude: number;
        accuracyM: number;
        consentGiven: true;
    }, {
        latitude: number;
        longitude: number;
        accuracyM: number;
        consentGiven: true;
    }>>;
}, "strip", z.ZodTypeAny, {
    deviceTimestamp: string;
    deviceId: string;
    gps?: {
        latitude: number;
        longitude: number;
        accuracyM: number;
        consentGiven: true;
    } | undefined;
}, {
    deviceTimestamp: string;
    deviceId: string;
    gps?: {
        latitude: number;
        longitude: number;
        accuracyM: number;
        consentGiven: true;
    } | undefined;
}>;
export declare const signSubmissionSchema: z.ZodObject<{
    /** Client-generated UUID — retries never double-sign or double-issue. */
    idempotencyKey: z.ZodString;
    verification: z.ZodObject<{
        schemaVersion: z.ZodLiteral<2>;
        certificateNumber: z.ZodString;
        nrcsBookNumber: z.ZodOptional<z.ZodString>;
        reportType: z.ZodEnum<["verification", "repair"]>;
        site: z.ZodObject<{
            customerName: z.ZodString;
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
        jobReference: z.ZodOptional<z.ZodString>;
        workOrderId: z.ZodOptional<z.ZodString>;
        dispenser: z.ZodObject<{
            dispenserId: z.ZodString;
            makeModel: z.ZodString;
            saApprovalNumber: z.ZodString;
            serialNumber: z.ZodString;
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
            hoseNumber: z.ZodString;
            product: z.ZodString;
            status: z.ZodEnum<["new", "repaired", "atu", "rejected"]>;
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
                nozzleBurst: z.ZodEnum<["pass", "fail", "na"]>;
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
                vfdMl: z.ZodNumber;
                vrefMl: z.ZodNumber;
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
            client: z.ZodObject<{
                name: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                name: string;
            }, {
                name: string;
            }>;
            declarationAccepted: z.ZodBoolean;
            expiryDate: z.ZodOptional<z.ZodString>;
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
        verificationDate: z.ZodString;
        provenance: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
            prefilled: z.ZodBoolean;
            source: z.ZodEnum<["manual", "onkey"]>;
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
    /** SHA-256 of the unsigned PDF bytes, computed on-device. */
    pdfSha256: z.ZodString;
    /** Unsigned PDF rendered on-device by expo-print, base64-encoded. */
    pdfBase64: z.ZodString;
    intentToSign: z.ZodObject<{
        /** Device clock at the moment the technician passed the biometric prompt. */
        deviceTimestamp: z.ZodString;
        deviceId: z.ZodString;
        gps: z.ZodOptional<z.ZodObject<{
            latitude: z.ZodNumber;
            longitude: z.ZodNumber;
            accuracyM: z.ZodNumber;
            /** POPIA: GPS is only captured with explicit consent. */
            consentGiven: z.ZodLiteral<true>;
        }, "strip", z.ZodTypeAny, {
            latitude: number;
            longitude: number;
            accuracyM: number;
            consentGiven: true;
        }, {
            latitude: number;
            longitude: number;
            accuracyM: number;
            consentGiven: true;
        }>>;
    }, "strip", z.ZodTypeAny, {
        deviceTimestamp: string;
        deviceId: string;
        gps?: {
            latitude: number;
            longitude: number;
            accuracyM: number;
            consentGiven: true;
        } | undefined;
    }, {
        deviceTimestamp: string;
        deviceId: string;
        gps?: {
            latitude: number;
            longitude: number;
            accuracyM: number;
            consentGiven: true;
        } | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    verification: {
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
    };
    idempotencyKey: string;
    pdfSha256: string;
    pdfBase64: string;
    intentToSign: {
        deviceTimestamp: string;
        deviceId: string;
        gps?: {
            latitude: number;
            longitude: number;
            accuracyM: number;
            consentGiven: true;
        } | undefined;
    };
}, {
    verification: {
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
    };
    idempotencyKey: string;
    pdfSha256: string;
    pdfBase64: string;
    intentToSign: {
        deviceTimestamp: string;
        deviceId: string;
        gps?: {
            latitude: number;
            longitude: number;
            accuracyM: number;
            consentGiven: true;
        } | undefined;
    };
}>;
export declare const signResponseSchema: z.ZodObject<{
    certificateNumber: z.ZodString;
    status: z.ZodLiteral<"issued">;
    signedPdfBase64: z.ZodString;
    signedPdfSha256: z.ZodString;
    signatureId: z.ZodString;
    /** Cryptographic signing time from the RFC 3161 TSA (or server clock in dev). */
    signedAt: z.ZodString;
    auditId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "issued";
    certificateNumber: string;
    signedPdfBase64: string;
    signedPdfSha256: string;
    signatureId: string;
    signedAt: string;
    auditId: string;
}, {
    status: "issued";
    certificateNumber: string;
    signedPdfBase64: string;
    signedPdfSha256: string;
    signatureId: string;
    signedAt: string;
    auditId: string;
}>;
export type SignSubmission = z.infer<typeof signSubmissionSchema>;
export type SignResponse = z.infer<typeof signResponseSchema>;
export type IntentToSign = z.infer<typeof intentToSignSchema>;
/** Sign-queue state machine (persisted in expo-sqlite; see CLAUDE.md). */
export declare const CERTIFICATE_STATES: readonly ["DRAFT", "READY_TO_SIGN", "QUEUED_FOR_SIGNING", "UPLOADING", "SIGNED", "SYNCED"];
export type CertificateState = (typeof CERTIFICATE_STATES)[number];
export declare const STATE_TRANSITIONS: Record<CertificateState, CertificateState[]>;
export declare function canTransition(from: CertificateState, to: CertificateState): boolean;

import { Verification, Checklist, HoseResult, Delivery } from '../src/verification';
import { computeEfd, DeliveryPoint } from '../src/tolerance';

/** A delivery row with EFD/pass computed from VFD vs VREF. */
export function makeDelivery(
  point: DeliveryPoint,
  vfdMl: number,
  vrefMl: number,
  flowRateLpm = 40,
): Delivery {
  const c = computeEfd(vfdMl, vrefMl);
  return { point, flowRateLpm, vfdMl, vrefMl, efdPercent: c.efdPercent, pass: c.pass };
}

const ALL_PASS: Checklist = {
  constructionMarking: 'pass',
  computerComputation: 'pass',
  hydraulics: 'pass',
  interlockingDevices: 'pass',
  hoseNozzleAutoStop: 'pass',
  solenoidValveTest: 'pass',
  presetTest: 'pass',
  measuresConformSans1698: 'pass',
  timeOut: 'pass',
  nozzleBurst: 'pass',
  zeroSetting: 'pass',
};

export function makeHose(overrides: Partial<HoseResult> = {}): HoseResult {
  return {
    hoseNumber: '1',
    product: 'ULP 95',
    status: 'new',
    components: {
      meter: { make: 'Tatsuno', model: 'TF', serial: 'M-001', saApproval: '119-AA20' },
      pcBoard: { make: 'Tatsuno', model: 'PB', serial: 'P-001', saApproval: '119-AA20' },
      pulsar: { make: 'Tatsuno', model: 'PL', serial: 'PU-001', saApproval: '119-AA20' },
      solenoid: { make: 'Tatsuno', model: 'SV', serial: 'S-001', saApproval: '119-AA20' },
    },
    testCondition: 'cold',
    qMinLpm: 15,
    qMaxLpm: 130,
    checklist: { ...ALL_PASS },
    deliveries: [
      makeDelivery('del1_max', 20010, 20000),
      makeDelivery('del2_max', 20010, 20000),
      makeDelivery('del3_max', 20000, 20000),
      makeDelivery('min_flow', 5005, 5000),
    ],
    outcome: 'certified',
    ...overrides,
  };
}

export function makeValidVerification(overrides: Partial<Verification> = {}): Verification {
  return {
    schemaVersion: 2,
    certificateNumber: 'PWC-JHB-000123-00',
    nrcsBookNumber: '139458',
    reportType: 'verification',
    site: {
      customerName: 'Engen',
      siteName: 'North Road Fuel Depot',
      address: '75 North Road, O.R. Tambo, Boksburg, 1459',
      telephone: '011 617 6000',
    },
    jobReference: 'WO-4711',
    workOrderId: 'WO-001',
    dispenser: {
      dispenserId: 'DISP-001',
      makeModel: 'Tatsuno SS-LX-E',
      saApprovalNumber: '119-AA20',
      serialNumber: 'TSN-99812',
      securitySealNumber: 'SEC-114281',
    },
    referenceMeasures: [
      {
        size: '200L',
        serialNumber: 'PRO-1148D',
        certificateNumber: 'D83126',
        calibrationDate: '2026-03-19',
        expiryDate: '2027-03-19',
      },
      {
        size: '20L',
        serialNumber: 'PRO-1103T',
        certificateNumber: 'D83126',
        calibrationDate: '2026-03-19',
        expiryDate: '2027-03-19',
      },
    ],
    methodReference: 'SANS Test Proc 01 & SANS Test Proc 02 based on LM-IR 117-2: 2023',
    hoses: [makeHose()],
    signOff: {
      vo: {
        identity: { subject: 'ms|abc-123', name: 'E. Sibisi', authMethod: 'microsoft' },
        pliersNumber: 'PRO 399',
      },
      client: { name: 'K. Moja' },
      declarationAccepted: true,
      expiryDate: '2027-07-14',
    },
    verificationDate: '2026-07-10',
    ...overrides,
  };
}

import { CalibrationForm } from '../src/calibration';
import { computeRow, DEFAULT_TOLERANCE_CLASS_ID, UNCERTAINTY_STATEMENT } from '../src/tolerance';

export function makeRow(indicated: number, measured: number, nominal = 20) {
  const c = computeRow(indicated, measured, DEFAULT_TOLERANCE_CLASS_ID);
  return {
    nominalDeliveryL: nominal,
    flowRateLpm: 38.5,
    indicatedVolumeL: indicated,
    measuredVolumeL: measured,
    errorMl: c.errorMl,
    errorPercent: c.errorPercent,
    pass: c.pass,
    toleranceClassId: DEFAULT_TOLERANCE_CLASS_ID,
  };
}

export function makeValidForm(overrides: Partial<CalibrationForm> = {}): CalibrationForm {
  return {
    schemaVersion: 1,
    job: {
      certificateNumber: 'PWC-JHB-000123-00',
      workOrderNumber: 'WO-4711',
      customerName: 'Engen Riverside',
      siteAddress: '1 Main Rd, Johannesburg, 2001',
      siteAssetNumber: 'FC-07',
      calibrationDate: '2026-07-10',
    },
    uut: {
      equipmentType: 'fuel_dispenser',
      manufacturer: 'Tatsuno',
      modelNumber: 'SS-LX-E',
      serialNumber: 'TSN-99812',
      nozzleId: 'A1',
      productGrade: 'ulp_95',
      meterKFactorBefore: 1.0012,
    },
    referenceStandards: [
      {
        registerId: 'STD-001',
        description: '20 L proving measure',
        serialNumber: 'PM-2044',
        certificateNumber: 'SANAS-CAL-8871',
        calibrationDueDate: '2027-01-31',
      },
    ],
    environment: {
      ambientTempC: 24.5,
      productTempC: 21.0,
      procedureRef: 'PWC-CP-001',
      uutCondition: 'good',
    },
    results: {
      asFound: [makeRow(20.05, 20.0), makeRow(19.98, 20.0)],
      adjustmentPerformed: false,
      uncertaintyStatement: UNCERTAINTY_STATEMENT,
      verificationSealNumbers: ['SEAL-1234'],
      photos: [],
    },
    signOff: {
      calibratedBy: {
        subject: 'ms|abc-123',
        name: 'T. Ngcobo',
        authMethod: 'microsoft',
      },
      technicalSignatory: { id: 'SIG-01', name: 'P. van Wyk' },
      declarationAccepted: true,
    },
    ...overrides,
  };
}

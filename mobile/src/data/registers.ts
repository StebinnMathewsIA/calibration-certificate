/**
 * PoC stand-ins for controlled internal registers. Production syncs these from
 * the backend so serials, certificate numbers and expiry dates cannot be typed
 * in. Reference measures are Prowalco's own proving measures (200/20/5 L).
 */
import type { Checklist, DeliveryPoint, ReferenceMeasure } from '@prowalco/schema';
import { DEFAULT_METHOD_REFERENCE } from '@prowalco/schema';

export const REFERENCE_MEASURES: ReferenceMeasure[] = [
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
  {
    size: '5L',
    serialNumber: 'PRO-1181Z',
    certificateNumber: 'D88126',
    calibrationDate: '2026-03-19',
    expiryDate: '2027-03-19',
  },
];

export const METHOD_REFERENCE = DEFAULT_METHOD_REFERENCE;

export const PRODUCT_OPTIONS = [
  { value: 'ULP 93', label: 'ULP 93' },
  { value: 'ULP 95', label: 'ULP 95' },
  { value: 'Diesel 50ppm', label: 'Diesel 50ppm' },
  { value: 'Diesel 500ppm', label: 'Diesel 500ppm' },
  { value: 'Paraffin', label: 'Paraffin' },
];

/** A fresh checklist with every item unset-but-defaulted to pass; the
 * technician flips the ones that fail. */
export function blankChecklist(): Checklist {
  return {
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
}

/** Nominal delivery volume (mL) for each delivery point, used to seed VFD. */
export const DELIVERY_NOMINAL_ML: Record<DeliveryPoint, number> = {
  del1_max: 20000,
  del2_max: 20000,
  del3_max: 20000,
  min_flow: 5000,
  preset: 20000,
};

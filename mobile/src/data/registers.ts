/**
 * PoC stand-ins for controlled internal registers. Production syncs these from
 * the backend so serials, certificate numbers and expiry dates cannot be typed
 * in. Reference measures are Prowalco's own proving measures (200/20/5 L).
 */
import type { DeliveryPoint, ReferenceMeasure } from '@prowalco/schema';
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

/**
 * VFD (volume the dispenser is set to deliver) is FIXED per delivery point —
 * 20 L at max/preset, 5 L at minimum flow — in millilitres. We pre-fill it;
 * the VO only reads back VREF from the proving measure.
 */
export const DELIVERY_NOMINAL_ML: Record<DeliveryPoint, number> = {
  del1_max: 20000,
  del2_max: 20000,
  del3_max: 20000,
  min_flow: 5000,
  preset: 20000,
};

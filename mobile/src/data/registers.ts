/**
 * Controlled internal constants. Proving measures are NO LONGER constants:
 * each technician registers their own certified measures (technician_measures
 * register, #70) — there are no defaults.
 */
import type { DeliveryPoint } from '@prowalco/schema';
import { DEFAULT_METHOD_REFERENCE } from '@prowalco/schema';

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

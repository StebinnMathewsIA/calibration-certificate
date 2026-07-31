/**
 * Controlled internal constants. Proving measures are NO LONGER constants:
 * each technician registers their own certified measures (technician_measures
 * register, #70) — there are no defaults.
 */
import type { DeliveryPoint } from '@prowalco/schema';
import { DEFAULT_METHOD_REFERENCE } from '@prowalco/schema';

export const METHOD_REFERENCE = DEFAULT_METHOD_REFERENCE;

/** Standard product list (#86), owner-supplied from the DoE price table. */
export const PRODUCT_OPTIONS = [
  '95 LRP',
  '95 ULP',
  'Diesel 0.05%',
  'Diesel 0.005%',
  'Illuminating Paraffin',
  'Liquefied Petroleum Gas',
];

/**
 * VFD (volume the dispenser is set to deliver) is FIXED per delivery point,
 * in millilitres, per the NRCS form (#87): 20 L for the three max-flow
 * deliveries, 5 L at minimum flow, 5 L for the preset delivery. Never
 * editable; the VO only reads back VREF from the proving measure.
 */
export const DELIVERY_NOMINAL_ML: Record<DeliveryPoint, number> = {
  del1_max: 20000,
  del2_max: 20000,
  del3_max: 20000,
  min_flow_20l: 20000,
  min_flow: 5000,
  preset: 5000,
};

/**
 * Controlled internal constants. Proving measures are NO LONGER constants:
 * each technician registers their own certified measures (technician_measures
 * register, #70) — there are no defaults.
 */
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

// Delivery nominals moved into the test-plan registry (#92):
// shared/schema/src/test-plans.ts is the single source.

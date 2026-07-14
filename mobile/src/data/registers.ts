/**
 * PoC stand-ins for controlled registers. Production syncs these from the
 * backend (equipment register, controlled procedures, authorised
 * signatories) so due dates and certificate numbers cannot be typed in.
 */
import type { ReferenceStandard } from '@prowalco/schema';

export const EQUIPMENT_REGISTER: ReferenceStandard[] = [
  {
    registerId: 'STD-001',
    description: '20 L proving measure',
    serialNumber: 'PM-2044',
    certificateNumber: 'SANAS-CAL-8871',
    calibrationDueDate: '2027-01-31',
  },
  {
    registerId: 'STD-002',
    description: '5 L proving measure',
    serialNumber: 'PM-1180',
    certificateNumber: 'SANAS-CAL-8412',
    calibrationDueDate: '2026-11-30',
  },
  {
    registerId: 'STD-003',
    description: 'Digital thermometer',
    serialNumber: 'TH-0332',
    certificateNumber: 'SANAS-CAL-9102',
    calibrationDueDate: '2027-03-15',
  },
];

export const PROCEDURES = [
  { value: 'PWC-CP-001', label: 'PWC-CP-001 Dispenser volumetric calibration' },
  { value: 'PWC-CP-002', label: 'PWC-CP-002 Flow meter calibration' },
];

export const SIGNATORIES = [
  { id: 'SIG-01', name: 'P. van Wyk' },
  { id: 'SIG-02', name: 'L. Dlamini' },
];

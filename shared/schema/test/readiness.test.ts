import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReadyToSign } from '../src/readiness';
import { makeValidVerification, makeHose, makeDelivery } from './fixtures';

const NOW = new Date('2026-07-14T09:00:00Z');

test('valid verification is ready to sign', () => {
  const r = validateReadyToSign(makeValidVerification(), { now: NOW });
  assert.deepEqual(r, { ready: true, reasons: [] });
});

test('declaration not ticked blocks signing', () => {
  const v = makeValidVerification();
  v.signOff.declarationAccepted = false;
  const r = validateReadyToSign(v, { now: NOW });
  assert.equal(r.ready, false);
  assert.ok(r.reasons.some((x) => x.includes('declaration')));
});

test('expired reference measure blocks signing', () => {
  const v = makeValidVerification();
  v.referenceMeasures[0].expiryDate = '2026-01-01';
  const r = validateReadyToSign(v, { now: NOW });
  assert.equal(r.ready, false);
  assert.ok(r.reasons.some((x) => x.includes('expired')));
});

test('tampered EFD is rejected', () => {
  const v = makeValidVerification();
  v.hoses[0].deliveries[0].efdPercent = 0.01; // real value is 0.05
  const r = validateReadyToSign(v, { now: NOW });
  assert.equal(r.ready, false);
  assert.ok(r.reasons.some((x) => x.includes('EFD')));
});

test('tampered pass flag is rejected', () => {
  const v = makeValidVerification();
  // genuinely out-of-tolerance delivery, but flagged pass
  v.hoses[0].deliveries.push({
    point: 'preset',
    flowRateLpm: 40,
    vfdMl: 20150,
    vrefMl: 20000,
    efdPercent: 0.75,
    pass: true, // lie
  });
  const r = validateReadyToSign(v, { now: NOW });
  assert.equal(r.ready, false);
  assert.ok(r.reasons.some((x) => x.includes('pass/fail')));
});

test('certified outcome with a failing checklist item is rejected', () => {
  const v = makeValidVerification();
  v.hoses[0].checklist.hydraulics = 'fail';
  const r = validateReadyToSign(v, { now: NOW });
  assert.equal(r.ready, false);
  assert.ok(r.reasons.some((x) => x.includes('certified')));
});

test('rejected hose requires a rejection certificate number', () => {
  const v = makeValidVerification();
  v.hoses = [
    makeHose({
      checklist: { ...makeHose().checklist, solenoidValveTest: 'fail' },
      outcome: 'rejected',
    }),
  ];
  const r = validateReadyToSign(v, { now: NOW });
  assert.equal(r.ready, false);
  assert.ok(r.reasons.some((x) => x.includes('rejectionCertNumber')));
});

test('rejected hose with a rejection cert number is accepted', () => {
  const v = makeValidVerification();
  v.hoses = [
    makeHose({
      checklist: { ...makeHose().checklist, solenoidValveTest: 'fail' },
      outcome: 'rejected',
    }),
  ];
  v.signOff.rejectionCertNumber = 'REJ-000045';
  const r = validateReadyToSign(v, { now: NOW });
  assert.deepEqual(r, { ready: true, reasons: [] });
});

test('missing VO pliers number blocks signing', () => {
  const v = makeValidVerification() as any;
  v.signOff.vo.pliersNumber = '';
  const r = validateReadyToSign(v, { now: NOW });
  assert.equal(r.ready, false);
  assert.ok(r.reasons.some((x) => x.includes('pliersNumber')));
});

test('future verification date blocks signing', () => {
  const v = makeValidVerification();
  v.verificationDate = '2026-12-25';
  const r = validateReadyToSign(v, { now: NOW });
  assert.equal(r.ready, false);
  assert.ok(r.reasons.some((x) => x.includes('future')));
});

test('schema violations are reported with paths', () => {
  const v = makeValidVerification() as any;
  v.certificateNumber = 'BAD-FORMAT';
  const r = validateReadyToSign(v, { now: NOW });
  assert.equal(r.ready, false);
  assert.ok(r.reasons.some((x) => x.startsWith('certificateNumber')));
});

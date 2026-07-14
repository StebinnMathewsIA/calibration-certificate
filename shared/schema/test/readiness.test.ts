import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReadyToSign } from '../src/readiness';
import { makeValidForm, makeRow } from './fixtures';

const NOW = new Date('2026-07-14T09:00:00Z');

test('valid form is ready to sign', () => {
  const r = validateReadyToSign(makeValidForm(), { now: NOW });
  assert.deepEqual(r, { ready: true, reasons: [] });
});

test('declaration not ticked blocks signing', () => {
  const form = makeValidForm();
  form.signOff.declarationAccepted = false;
  const r = validateReadyToSign(form, { now: NOW });
  assert.equal(r.ready, false);
  assert.ok(r.reasons.some((x) => x.includes('declaration')));
});

test('expired reference standard blocks signing', () => {
  const form = makeValidForm();
  form.referenceStandards[0].calibrationDueDate = '2026-01-01';
  const r = validateReadyToSign(form, { now: NOW });
  assert.equal(r.ready, false);
  assert.ok(r.reasons.some((x) => x.includes('expired')));
});

test('tampered errorPercent is rejected', () => {
  const form = makeValidForm();
  form.results.asFound[0].errorPercent = 0.01; // real value is 0.25
  const r = validateReadyToSign(form, { now: NOW });
  assert.equal(r.ready, false);
  assert.ok(r.reasons.some((x) => x.includes('error (%)')));
});

test('tampered pass flag is rejected', () => {
  const form = makeValidForm();
  form.results.asFound.push(makeRow(20.15, 20.0)); // genuinely out of tolerance
  form.results.asFound[2].pass = true; // lie about it
  const r = validateReadyToSign(form, { now: NOW });
  assert.equal(r.ready, false);
  assert.ok(r.reasons.some((x) => x.includes('pass/fail')));
});

test('adjustment performed requires as-left rows', () => {
  const form = makeValidForm();
  form.results.adjustmentPerformed = true;
  const r = validateReadyToSign(form, { now: NOW });
  assert.equal(r.ready, false);
  assert.ok(r.reasons.some((x) => x.toLowerCase().includes('as-left')));
});

test('future calibration date blocks signing', () => {
  const form = makeValidForm();
  form.job.calibrationDate = '2026-12-25';
  // keep standards in date relative to the (invalid) cal date
  const r = validateReadyToSign(form, { now: NOW });
  assert.equal(r.ready, false);
  assert.ok(r.reasons.some((x) => x.includes('future')));
});

test('schema violations are reported with paths', () => {
  const form = makeValidForm() as any;
  form.job.certificateNumber = 'BAD-FORMAT';
  const r = validateReadyToSign(form, { now: NOW });
  assert.equal(r.ready, false);
  assert.ok(r.reasons.some((x) => x.startsWith('job.certificateNumber')));
});

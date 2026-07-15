import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEfd, MPE_PERCENT } from '../src/tolerance';

test('EFD = (VFD − VREF)/VREF × 100', () => {
  const r = computeEfd(20100, 20000);
  assert.equal(r.efdPercent, 0.5);
  assert.equal(r.pass, true); // exactly at the 0.5% MPE boundary
});

test('negative EFD (dispenser under-reads reference)', () => {
  const r = computeEfd(19900, 20000);
  assert.equal(r.efdPercent, -0.5);
  assert.equal(r.pass, true);
});

test('outside MPE fails', () => {
  const r = computeEfd(20150, 20000);
  assert.equal(r.efdPercent, 0.75);
  assert.equal(r.pass, false);
});

test('small EFD within tolerance passes', () => {
  const r = computeEfd(20010, 20000);
  assert.equal(r.efdPercent, 0.05);
  assert.equal(r.pass, true);
});

test('rounding is stable at floating point boundaries', () => {
  // 20005/20000 = 1.00025 → 0.025% → rounds to 0.03 at 2 dp
  const r = computeEfd(20005, 20000);
  assert.equal(r.efdPercent, 0.03);
});

test('MPE is 0.5% (provisional)', () => {
  assert.equal(MPE_PERCENT, 0.5);
});

test('rejects non-positive reference volume', () => {
  assert.throws(() => computeEfd(20000, 0));
  assert.throws(() => computeEfd(20000, -1));
});

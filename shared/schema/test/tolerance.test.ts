import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRow } from '../src/tolerance';

test('errorMl = (indicated − measured) × 1000', () => {
  const r = computeRow(20.05, 20.0);
  assert.equal(r.errorMl, 50);
  assert.equal(r.errorPercent, 0.25);
  assert.equal(r.pass, true);
});

test('negative error (under-delivery reading)', () => {
  const r = computeRow(19.9, 20.0);
  assert.equal(r.errorMl, -100);
  assert.equal(r.errorPercent, -0.5);
  assert.equal(r.pass, true); // exactly at the 0.5% MPE boundary
});

test('outside tolerance fails', () => {
  const r = computeRow(20.15, 20.0);
  assert.equal(r.errorPercent, 0.75);
  assert.equal(r.pass, false);
});

test('tighter class 0.3 fails where 0.5 passes', () => {
  const r = computeRow(20.08, 20.0, 'oiml_r117_class_0_3');
  assert.equal(r.errorPercent, 0.4);
  assert.equal(r.pass, false);
});

test('rounding is stable at floating point boundaries', () => {
  const r = computeRow(20.0001, 20.0);
  assert.equal(r.errorMl, 0.1);
});

test('rejects unknown tolerance class and zero measured volume', () => {
  assert.throws(() => computeRow(20, 20, 'nope'));
  assert.throws(() => computeRow(20, 0));
});

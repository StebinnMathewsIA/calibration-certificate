import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, CERTIFICATE_STATES, signSubmissionSchema } from '../src/envelope';
import { makeValidForm } from './fixtures';

test('happy-path state transitions', () => {
  assert.ok(canTransition('DRAFT', 'READY_TO_SIGN'));
  assert.ok(canTransition('READY_TO_SIGN', 'QUEUED_FOR_SIGNING'));
  assert.ok(canTransition('QUEUED_FOR_SIGNING', 'UPLOADING'));
  assert.ok(canTransition('UPLOADING', 'SIGNED'));
  assert.ok(canTransition('SIGNED', 'SYNCED'));
});

test('upload failure returns to queue; edits return to draft', () => {
  assert.ok(canTransition('UPLOADING', 'QUEUED_FOR_SIGNING'));
  assert.ok(canTransition('READY_TO_SIGN', 'DRAFT'));
});

test('illegal transitions are rejected', () => {
  assert.equal(canTransition('DRAFT', 'SIGNED'), false);
  assert.equal(canTransition('SIGNED', 'DRAFT'), false);
  assert.equal(canTransition('SYNCED', 'DRAFT'), false);
  for (const s of CERTIFICATE_STATES) {
    assert.equal(canTransition('SYNCED', s), false);
  }
});

test('sign submission envelope validates', () => {
  const submission = {
    idempotencyKey: '7f9c24e5-3b2a-4d1c-9e8f-1a2b3c4d5e6f',
    form: makeValidForm(),
    pdfSha256: 'a'.repeat(64),
    pdfBase64: 'JVBERi0xLjQ=',
    intentToSign: {
      deviceTimestamp: '2026-07-14T08:59:31Z',
      deviceId: 'device-abc',
      gps: { latitude: -26.2041, longitude: 28.0473, accuracyM: 8, consentGiven: true },
    },
  };
  const parsed = signSubmissionSchema.safeParse(submission);
  assert.ok(parsed.success, JSON.stringify(!parsed.success && parsed.error.issues));
});

test('gps without consent is rejected (POPIA)', () => {
  const submission: any = {
    idempotencyKey: '7f9c24e5-3b2a-4d1c-9e8f-1a2b3c4d5e6f',
    form: makeValidForm(),
    pdfSha256: 'a'.repeat(64),
    pdfBase64: 'JVBERi0xLjQ=',
    intentToSign: {
      deviceTimestamp: '2026-07-14T08:59:31Z',
      deviceId: 'device-abc',
      gps: { latitude: -26.2, longitude: 28.0, accuracyM: 8, consentGiven: false },
    },
  };
  assert.equal(signSubmissionSchema.safeParse(submission).success, false);
});

import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';

import { redactEmail, verifySignature } from './email.js';

const SECRET = 'whsec_test_20ef8a6f8c5166ae0872f6a4847b67782e44e3da2ef1e840277020cb42c26a4c';

function sign(secret: string, tsMs: string, body: string): string {
  return `v1=${createHmac('sha256', secret).update(`${tsMs}.${body}`).digest('hex')}`;
}

describe('verifySignature', () => {
  const NOW = 1_747_000_000_000; // milliseconds
  const body = '{"type":"email.delivered","messageId":"m_1"}';
  const validSig = sign(SECRET, String(NOW), body);

  test('accepts a freshly-signed payload within the tolerance window', () => {
    expect(
      verifySignature({
        secret: SECRET,
        signatureHeader: validSig,
        timestampHeader: String(NOW),
        body,
        nowMs: NOW,
      }),
    ).toBe(true);
    // 4 minutes 50 seconds drift — still under the 5 min default
    expect(
      verifySignature({
        secret: SECRET,
        signatureHeader: validSig,
        timestampHeader: String(NOW),
        body,
        nowMs: NOW + 290_000,
      }),
    ).toBe(true);
  });

  test('rejects a payload outside the tolerance window (replay defence)', () => {
    expect(
      verifySignature({
        secret: SECRET,
        signatureHeader: validSig,
        timestampHeader: String(NOW),
        body,
        nowMs: NOW + 301_000,
      }),
    ).toBe(false);
    expect(
      verifySignature({
        secret: SECRET,
        signatureHeader: validSig,
        timestampHeader: String(NOW),
        body,
        nowMs: NOW - 301_000,
      }),
    ).toBe(false);
  });

  test('rejects when the body has been tampered with', () => {
    expect(
      verifySignature({
        secret: SECRET,
        signatureHeader: validSig,
        timestampHeader: String(NOW),
        body: '{"type":"email.delivered","messageId":"m_2"}',
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  test('rejects when the signature byte does not match', () => {
    const flipped = validSig.endsWith('a')
      ? validSig.replace(/a$/, 'b')
      : validSig.replace(/.$/, 'a');
    expect(
      verifySignature({
        secret: SECRET,
        signatureHeader: flipped,
        timestampHeader: String(NOW),
        body,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  test('rejects when the secret is wrong', () => {
    expect(
      verifySignature({
        secret: `${SECRET}_different`,
        signatureHeader: validSig,
        timestampHeader: String(NOW),
        body,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  test('rejects malformed or missing headers', () => {
    expect(
      verifySignature({ secret: SECRET, signatureHeader: null, timestampHeader: String(NOW), body, nowMs: NOW }),
    ).toBe(false);
    expect(
      verifySignature({ secret: SECRET, signatureHeader: validSig, timestampHeader: null, body, nowMs: NOW }),
    ).toBe(false);
    expect(
      verifySignature({
        secret: SECRET,
        // Missing the v1= prefix → reject.
        signatureHeader: validSig.replace('v1=', ''),
        timestampHeader: String(NOW),
        body,
        nowMs: NOW,
      }),
    ).toBe(false);
    expect(
      verifySignature({
        secret: SECRET,
        signatureHeader: validSig,
        timestampHeader: 'not-a-number',
        body,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  test('signature length must match exactly (no truncation attacks)', () => {
    expect(
      verifySignature({
        secret: SECRET,
        signatureHeader: validSig.slice(0, validSig.length / 2),
        timestampHeader: String(NOW),
        body,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  test('custom tolerance window', () => {
    expect(
      verifySignature({
        secret: SECRET,
        signatureHeader: validSig,
        timestampHeader: String(NOW),
        body,
        nowMs: NOW + 60_000,
        toleranceMs: 30_000,
      }),
    ).toBe(false);
  });
});

describe('redactEmail', () => {
  test('redacts a typical address', () => {
    expect(redactEmail('flandriendev@hotmail.com')).toBe('f•••v@h•••m');
  });

  test('handles a two-letter local part', () => {
    expect(redactEmail('jo@example.com')).toBe('j•••o@e•••m');
  });

  test('handles a single-letter local part', () => {
    expect(redactEmail('a@example.com')).toBe('a@e•••m');
  });

  test('returns a safe sentinel on a malformed input (no @)', () => {
    expect(redactEmail('not-an-email')).toBe('•••');
  });

  test('handles an empty local part (edge case)', () => {
    expect(redactEmail('@example.com')).toBe('@e•••m');
  });
});

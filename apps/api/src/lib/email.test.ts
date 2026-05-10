import { describe, expect, test } from 'bun:test';

import { signPayload, verifySignature } from './email.js';

const SECRET = 'whsec_test_20ef8a6f8c5166ae0872f6a4847b67782e44e3da2ef1e840277020cb42c26a4c';

describe('signPayload', () => {
  test('produces a deterministic 64-char hex digest', () => {
    const sig = signPayload(SECRET, '1747000000', '{"type":"email.delivered"}');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(signPayload(SECRET, '1747000000', '{"type":"email.delivered"}')).toBe(sig);
  });

  test('changes when timestamp, body, or secret change', () => {
    const base = signPayload(SECRET, '1747000000', '{"a":1}');
    expect(signPayload(SECRET, '1747000001', '{"a":1}')).not.toBe(base);
    expect(signPayload(SECRET, '1747000000', '{"a":2}')).not.toBe(base);
    expect(signPayload(`${SECRET}x`, '1747000000', '{"a":1}')).not.toBe(base);
  });
});

describe('verifySignature', () => {
  const now = 1_747_000_000;
  const body = '{"type":"email.delivered","messageId":"m_1"}';
  const validSig = signPayload(SECRET, String(now), body);
  const validHeader = `t=${now},v1=${validSig}`;

  test('accepts a freshly-signed payload within the tolerance window', () => {
    expect(verifySignature({ secret: SECRET, header: validHeader, body, nowSec: now })).toBe(true);
    // 4 minutes 50 sec drift — still under the 300s default tolerance
    expect(
      verifySignature({ secret: SECRET, header: validHeader, body, nowSec: now + 290 }),
    ).toBe(true);
  });

  test('rejects a payload outside the tolerance window (replay defence)', () => {
    expect(
      verifySignature({ secret: SECRET, header: validHeader, body, nowSec: now + 301 }),
    ).toBe(false);
    expect(
      verifySignature({ secret: SECRET, header: validHeader, body, nowSec: now - 301 }),
    ).toBe(false);
  });

  test('rejects when the body has been tampered with', () => {
    expect(
      verifySignature({
        secret: SECRET,
        header: validHeader,
        body: '{"type":"email.delivered","messageId":"m_2"}',
        nowSec: now,
      }),
    ).toBe(false);
  });

  test('rejects when the signature byte does not match', () => {
    const flipped = validSig.replace(/.$/, validSig.endsWith('a') ? 'b' : 'a');
    expect(
      verifySignature({ secret: SECRET, header: `t=${now},v1=${flipped}`, body, nowSec: now }),
    ).toBe(false);
  });

  test('rejects when the secret is wrong', () => {
    expect(
      verifySignature({
        secret: `${SECRET}_different`,
        header: validHeader,
        body,
        nowSec: now,
      }),
    ).toBe(false);
  });

  test('rejects malformed headers', () => {
    expect(verifySignature({ secret: SECRET, header: null, body, nowSec: now })).toBe(false);
    expect(verifySignature({ secret: SECRET, header: '', body, nowSec: now })).toBe(false);
    expect(verifySignature({ secret: SECRET, header: 'not-a-header', body, nowSec: now })).toBe(
      false,
    );
    expect(verifySignature({ secret: SECRET, header: `t=${now}`, body, nowSec: now })).toBe(false);
    expect(verifySignature({ secret: SECRET, header: `v1=${validSig}`, body, nowSec: now })).toBe(
      false,
    );
    expect(
      verifySignature({ secret: SECRET, header: `t=notanumber,v1=${validSig}`, body, nowSec: now }),
    ).toBe(false);
  });

  test('signature length must match exactly (no truncation attacks)', () => {
    expect(
      verifySignature({
        secret: SECRET,
        header: `t=${now},v1=${validSig.slice(0, 32)}`,
        body,
        nowSec: now,
      }),
    ).toBe(false);
  });

  test('custom tolerance window', () => {
    expect(
      verifySignature({
        secret: SECRET,
        header: validHeader,
        body,
        nowSec: now + 60,
        toleranceSec: 30,
      }),
    ).toBe(false);
  });
});

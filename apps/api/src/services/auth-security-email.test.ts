import { describe, expect, test } from 'bun:test';

import { checkEmailGate, normalizeEmail } from './auth-security.js';

describe('normalizeEmail', () => {
  test('lowercases and trims', () => {
    expect(normalizeEmail('  Foo@Example.COM ')).toBe('foo@example.com');
  });

  test('gmail dots + plus aliases collapse', () => {
    expect(normalizeEmail('a.b.c+promo@gmail.com')).toBe('abc@gmail.com');
    expect(normalizeEmail('abc@gmail.com')).toBe('abc@gmail.com');
    expect(normalizeEmail('A.B.C@googlemail.com')).toBe('abc@gmail.com');
  });

  test('non-gmail keeps dots and plus', () => {
    expect(normalizeEmail('a.b+x@company.com')).toBe('a.b+x@company.com');
  });
});

describe('checkEmailGate + gmail normalize', () => {
  test('blocklist on gmail domain still catches plus aliases', () => {
    const gate = checkEmailGate('evil+tag@gmail.com', {
      allowedDomains: [],
      blockedDomains: ['gmail.com'],
      blockDisposable: false,
      blockSubaddresses: false,
    });
    // domain check uses normalized domain gmail.com
    expect(gate.allowed).toBe(false);
  });
});

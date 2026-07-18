import { describe, expect, test } from 'bun:test';

import {
  domainVerificationTxt,
  sanitizeRelayState,
  sdkKeyAllowsMethod,
  txtRecordsContainDomainToken,
} from './auth-hardening.js';

describe('txtRecordsContainDomainToken', () => {
  const token = 'tok_abc123';

  test('matches preferred briven-domain-verification= form', () => {
    const records = [[domainVerificationTxt(token)]];
    expect(txtRecordsContainDomainToken(records, token)).toBe(true);
  });

  test('matches raw token for backward compatibility', () => {
    expect(txtRecordsContainDomainToken([['other', token]], token)).toBe(true);
  });

  test('rejects missing token', () => {
    expect(txtRecordsContainDomainToken([['v=spf1']], token)).toBe(false);
    expect(txtRecordsContainDomainToken([], token)).toBe(false);
  });
});

describe('sanitizeRelayState', () => {
  const origins = ['https://app.example.com', 'https://briven.tech'];

  test('allows relative paths', () => {
    expect(sanitizeRelayState('/dashboard', origins)).toBe('/dashboard');
    expect(sanitizeRelayState('/', origins)).toBe('/');
  });

  test('allows absolute URL on allowlist', () => {
    expect(sanitizeRelayState('https://app.example.com/cb', origins)).toBe(
      'https://app.example.com/cb',
    );
  });

  test('blocks open redirects and evil schemes', () => {
    expect(sanitizeRelayState('https://evil.com/phish', origins)).toBe('/');
    expect(sanitizeRelayState('//evil.com/phish', origins)).toBe('/');
    expect(sanitizeRelayState('javascript:alert(1)', origins)).toBe('/');
    expect(sanitizeRelayState('data:text/html,hi', origins)).toBe('/');
  });

  test('empty / null falls back to /', () => {
    expect(sanitizeRelayState(null, origins)).toBe('/');
    expect(sanitizeRelayState('', origins)).toBe('/');
  });
});

describe('sdkKeyAllowsMethod', () => {
  test('read scope is GET/HEAD/OPTIONS only', () => {
    expect(sdkKeyAllowsMethod('read', 'GET')).toBe(true);
    expect(sdkKeyAllowsMethod('read', 'POST')).toBe(false);
    expect(sdkKeyAllowsMethod('read', 'DELETE')).toBe(false);
  });

  test('read-write and admin allow mutating methods', () => {
    expect(sdkKeyAllowsMethod('read-write', 'POST')).toBe(true);
    expect(sdkKeyAllowsMethod('admin', 'DELETE')).toBe(true);
  });
});

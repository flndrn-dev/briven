import { describe, expect, test } from 'bun:test';

import {
  ScimError,
  parseScimEqFilter,
  parseScimUserPayload,
  scimGroupLocation,
  scimUserLocation,
} from './auth-scim.js';

describe('auth-scim pure helpers (Phase 9)', () => {
  test('parseScimUserPayload requires userName and email', () => {
    expect(() => parseScimUserPayload({})).toThrow(ScimError);
    expect(() => parseScimUserPayload({ userName: 'not-an-email' })).toThrow(ScimError);
  });

  test('parseScimUserPayload accepts userName as email', () => {
    const p = parseScimUserPayload({
      userName: 'alice@acme.com',
      displayName: 'Alice',
      active: true,
    });
    expect(p.email).toBe('alice@acme.com');
    expect(p.userName).toBe('alice@acme.com');
    expect(p.displayName).toBe('Alice');
    expect(p.active).toBe(true);
  });

  test('parseScimUserPayload prefers emails[].value', () => {
    const p = parseScimUserPayload({
      userName: 'alice',
      emails: [{ value: 'alice@corp.io', primary: true }],
      name: { givenName: 'Alice', familyName: 'A' },
    });
    expect(p.email).toBe('alice@corp.io');
    expect(p.displayName).toBe('Alice A');
  });

  test('parseScimUserPayload active defaults true; false when set', () => {
    expect(parseScimUserPayload({ userName: 'a@b.co' }).active).toBe(true);
    expect(parseScimUserPayload({ userName: 'a@b.co', active: false }).active).toBe(false);
  });

  test('parseScimEqFilter supports attr eq "value"', () => {
    expect(parseScimEqFilter(undefined)).toBeNull();
    expect(parseScimEqFilter('userName eq "alice@acme.com"')).toEqual({
      attr: 'username',
      value: 'alice@acme.com',
    });
    expect(() => parseScimEqFilter('userName co "x"')).toThrow(ScimError);
  });

  test('scim locations are project-scoped', () => {
    expect(scimUserLocation('p_abc', 'scimu_1', 'https://api.briven.tech')).toBe(
      'https://api.briven.tech/v1/projects/p_abc/scim/v2/Users/scimu_1',
    );
    expect(scimGroupLocation('p_abc', 'scimg_1', 'https://api.briven.tech/')).toBe(
      'https://api.briven.tech/v1/projects/p_abc/scim/v2/Groups/scimg_1',
    );
  });
});

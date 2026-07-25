import { describe, expect, test } from 'bun:test';

import {
  isMintableServiceBadgeProduct,
  isServiceBadgeProduct,
  isServiceBadgeRole,
  looksLikeServiceBadge,
  serviceBadgeAllowedOnRoute,
  SERVICE_BADGE_PREFIX,
} from './service-badges.js';

describe('service badge product helpers', () => {
  test('accepts known products', () => {
    expect(isServiceBadgeProduct('db')).toBe(true);
    expect(isServiceBadgeProduct('s3')).toBe(true);
    expect(isServiceBadgeProduct('auth')).toBe(true);
    expect(isServiceBadgeProduct('pay')).toBe(true);
  });

  test('rejects unknown products', () => {
    expect(isServiceBadgeProduct('mcp')).toBe(false);
    expect(isServiceBadgeProduct('')).toBe(false);
  });

  test('pay is reserved — not mintable yet', () => {
    expect(isMintableServiceBadgeProduct('db')).toBe(true);
    expect(isMintableServiceBadgeProduct('s3')).toBe(true);
    expect(isMintableServiceBadgeProduct('auth')).toBe(true);
    expect(isMintableServiceBadgeProduct('pay')).toBe(false);
  });

  test('roles are viewer | developer | admin', () => {
    expect(isServiceBadgeRole('viewer')).toBe(true);
    expect(isServiceBadgeRole('developer')).toBe(true);
    expect(isServiceBadgeRole('admin')).toBe(true);
    expect(isServiceBadgeRole('owner')).toBe(false);
  });
});

describe('looksLikeServiceBadge', () => {
  test('matches product prefixes', () => {
    expect(looksLikeServiceBadge(`${SERVICE_BADGE_PREFIX.db}abc`)).toBe(true);
    expect(looksLikeServiceBadge(`${SERVICE_BADGE_PREFIX.s3}abc`)).toBe(true);
    expect(looksLikeServiceBadge(`${SERVICE_BADGE_PREFIX.auth}abc`)).toBe(true);
  });

  test('rejects other key shapes', () => {
    expect(looksLikeServiceBadge('brk_abc')).toBe(false);
    expect(looksLikeServiceBadge('pk_briven_mcp_abc')).toBe(false);
    expect(looksLikeServiceBadge('m2m_abc')).toBe(false);
  });
});

describe('serviceBadgeAllowedOnRoute — product walls', () => {
  test('session / brk_ (no badge product) may enter any wall', () => {
    expect(serviceBadgeAllowedOnRoute(null, 'db')).toBe(true);
    expect(serviceBadgeAllowedOnRoute(null, 's3')).toBe(true);
    expect(serviceBadgeAllowedOnRoute(null, 'auth')).toBe(true);
    expect(serviceBadgeAllowedOnRoute(undefined, 'db')).toBe(true);
  });

  test('db badge only opens Doltgres wall', () => {
    expect(serviceBadgeAllowedOnRoute('db', 'db')).toBe(true);
    expect(serviceBadgeAllowedOnRoute('db', 's3')).toBe(false);
    expect(serviceBadgeAllowedOnRoute('db', 'auth')).toBe(false);
  });

  test('s3 badge only opens S3 wall', () => {
    expect(serviceBadgeAllowedOnRoute('s3', 's3')).toBe(true);
    expect(serviceBadgeAllowedOnRoute('s3', 'db')).toBe(false);
  });

  test('auth badge only opens Auth wall', () => {
    expect(serviceBadgeAllowedOnRoute('auth', 'auth')).toBe(true);
    expect(serviceBadgeAllowedOnRoute('auth', 'db')).toBe(false);
  });

  test('no badge may open routeProduct=any (everything)', () => {
    expect(serviceBadgeAllowedOnRoute('db', 'any')).toBe(false);
    expect(serviceBadgeAllowedOnRoute(null, 'any')).toBe(true);
  });
});

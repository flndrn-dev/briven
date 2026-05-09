import { describe, expect, test } from 'bun:test';

import { effectiveRole, hasRoleAtLeast } from './access.js';

describe('effectiveRole', () => {
  test('returns null when both roles are null', () => {
    expect(effectiveRole(null, null)).toBeNull();
  });

  test('returns the project role when only project role is set', () => {
    expect(effectiveRole(null, 'admin')).toBe('admin');
    expect(effectiveRole(null, 'developer')).toBe('developer');
    expect(effectiveRole(null, 'viewer')).toBe('viewer');
    expect(effectiveRole(null, 'owner')).toBe('owner');
  });

  test('returns the org role when only org role is set', () => {
    expect(effectiveRole('viewer', null)).toBe('viewer');
    expect(effectiveRole('admin', null)).toBe('admin');
  });

  test('takes the higher-rank role when both are set', () => {
    expect(effectiveRole('viewer', 'admin')).toBe('admin');
    expect(effectiveRole('admin', 'viewer')).toBe('admin');
    expect(effectiveRole('owner', 'developer')).toBe('owner');
    expect(effectiveRole('developer', 'owner')).toBe('owner');
  });

  test('returns either when ranks are equal', () => {
    expect(effectiveRole('admin', 'admin')).toBe('admin');
    expect(effectiveRole('developer', 'developer')).toBe('developer');
  });
});

describe('hasRoleAtLeast', () => {
  test('owner satisfies every minimum', () => {
    expect(hasRoleAtLeast('owner', 'viewer')).toBe(true);
    expect(hasRoleAtLeast('owner', 'developer')).toBe(true);
    expect(hasRoleAtLeast('owner', 'admin')).toBe(true);
    expect(hasRoleAtLeast('owner', 'owner')).toBe(true);
  });

  test('admin covers admin and below, not owner', () => {
    expect(hasRoleAtLeast('admin', 'viewer')).toBe(true);
    expect(hasRoleAtLeast('admin', 'developer')).toBe(true);
    expect(hasRoleAtLeast('admin', 'admin')).toBe(true);
    expect(hasRoleAtLeast('admin', 'owner')).toBe(false);
  });

  test('developer covers developer and viewer', () => {
    expect(hasRoleAtLeast('developer', 'viewer')).toBe(true);
    expect(hasRoleAtLeast('developer', 'developer')).toBe(true);
    expect(hasRoleAtLeast('developer', 'admin')).toBe(false);
    expect(hasRoleAtLeast('developer', 'owner')).toBe(false);
  });

  test('viewer covers only viewer', () => {
    expect(hasRoleAtLeast('viewer', 'viewer')).toBe(true);
    expect(hasRoleAtLeast('viewer', 'developer')).toBe(false);
    expect(hasRoleAtLeast('viewer', 'admin')).toBe(false);
    expect(hasRoleAtLeast('viewer', 'owner')).toBe(false);
  });
});

/**
 * Owner-tier gating scaffolding — narrative tests.
 *
 * No route in the API today gates at `owner` (admin is the practical
 * ceiling). When a future destructive route lands (project hard-delete,
 * ownership transfer, etc.), it should chain `requireProjectRole('owner')`
 * after `requireProjectAuth`. These tests pin the rank semantics so a
 * regression in `ROLE_RANK` would fail before such a route ships.
 */
describe('owner-tier gating', () => {
  test('admin cannot pass an owner gate', () => {
    // The most-privileged non-owner role still falls below the owner gate.
    expect(hasRoleAtLeast('admin', 'owner')).toBe(false);
  });

  test('owner passes the owner gate', () => {
    expect(hasRoleAtLeast('owner', 'owner')).toBe(true);
  });

  test('an api key can never reach the owner gate', () => {
    // `routes/api-keys.ts:createKeySchema` rejects 'owner' as an
    // assignable role (only viewer/developer/admin); the existing
    // `services/api-keys.ts:isAssignableKeyRole` enforces the same.
    // So no resolved api-key role can satisfy `requireProjectRole('owner')`.
    expect(hasRoleAtLeast('admin', 'owner')).toBe(false);
    expect(hasRoleAtLeast('developer', 'owner')).toBe(false);
    expect(hasRoleAtLeast('viewer', 'owner')).toBe(false);
  });
});

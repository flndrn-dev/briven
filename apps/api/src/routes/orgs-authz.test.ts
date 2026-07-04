// apps/api/src/routes/orgs-authz.test.ts
//
// Zone-2 regression test for the org-member-mutation privilege-escalation fix.
//
// Bug: PATCH /v1/orgs/:id/members/:userId (role change), DELETE …/members/:userId
// (member removal) and POST …/invitations gated on `isOrgMember` ONLY — so any
// member (including a viewer) could change roles, remove the owner, or invite.
//
// Fix: those three routes now gate on the caller's org role via
// `getOrgRole(...)` + `hasRoleAtLeast(role, 'admin')` — a viewer/developer is
// rejected, admin/owner allowed. This test pins that exact predicate (the
// route's authorisation decision) without needing a DB.

import { describe, expect, it } from 'bun:test';

import { hasRoleAtLeast } from '../services/access.js';
import { orgRole } from '../db/schema.js';

describe('org-member-mutation admin gate', () => {
  // Mirrors the route guard: `!actorRole || !hasRoleAtLeast(actorRole, 'admin')`
  const allowed = (role: (typeof orgRole)[number] | null): boolean =>
    Boolean(role) && hasRoleAtLeast(role as (typeof orgRole)[number], 'admin');

  it('denies a viewer', () => {
    expect(allowed('viewer')).toBe(false);
  });

  it('denies a developer', () => {
    expect(allowed('developer')).toBe(false);
  });

  it('allows an admin', () => {
    expect(allowed('admin')).toBe(true);
  });

  it('allows an owner', () => {
    expect(allowed('owner')).toBe(true);
  });

  it('denies a non-member (null role)', () => {
    expect(allowed(null)).toBe(false);
  });
});

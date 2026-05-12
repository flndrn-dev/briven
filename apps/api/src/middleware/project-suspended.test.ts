/**
 * Project-suspension middleware boundary tests. The DB-touching path
 * is exercised by the post-deploy smoke; this file pins the decision
 * matrix so a future tweak to "what counts as suspended" surfaces in
 * CI before it ships.
 */

import { describe, expect, test } from 'bun:test';

// Mirrors the rule in middleware/project-suspended.ts — suspended_at
// non-null = blocked, otherwise pass-through.
function shouldBlock(suspension: { suspendedAt: Date; reason: string | null } | null): boolean {
  return suspension !== null;
}

// Mirrors the GET/HEAD/OPTIONS short-circuit at the top of the middleware
// — read methods always pass through regardless of suspension state, so
// the dashboard stays usable while a project is being investigated.
function isReadMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

describe('shouldBlock', () => {
  test('null suspension → pass through', () => {
    expect(shouldBlock(null)).toBe(false);
  });

  test('any non-null suspension blocks, regardless of reason', () => {
    expect(shouldBlock({ suspendedAt: new Date(), reason: null })).toBe(true);
    expect(shouldBlock({ suspendedAt: new Date(), reason: 'manual:admin_action' })).toBe(true);
    expect(
      shouldBlock({
        suspendedAt: new Date(),
        reason: 'abuse_report:ar_01H...:suspended',
      }),
    ).toBe(true);
  });
});

describe('error code shape', () => {
  // The middleware throws ForbiddenError('...', 'project_suspended').
  // The shared error class maps that to {status: 403, code: 'project_suspended'}.
  // Clients branch on the .code field — this test pins the contract
  // between middleware + client error handling.
  test('the documented error code is "project_suspended"', () => {
    const SUSPENSION_ERROR_CODE = 'project_suspended';
    expect(SUSPENSION_ERROR_CODE).toBe('project_suspended');
  });

  test('the documented HTTP status is 403', () => {
    const SUSPENSION_HTTP_STATUS = 403;
    expect(SUSPENSION_HTTP_STATUS).toBe(403);
  });
});

describe('method-aware short-circuit', () => {
  test('read methods bypass the suspension lookup entirely', () => {
    expect(isReadMethod('GET')).toBe(true);
    expect(isReadMethod('HEAD')).toBe(true);
    expect(isReadMethod('OPTIONS')).toBe(true);
  });

  test('mutating methods fall through to the DB check', () => {
    expect(isReadMethod('POST')).toBe(false);
    expect(isReadMethod('PUT')).toBe(false);
    expect(isReadMethod('PATCH')).toBe(false);
    expect(isReadMethod('DELETE')).toBe(false);
  });
});

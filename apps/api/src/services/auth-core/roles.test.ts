import { describe, expect, test } from 'bun:test';

import {
  assignBrivenEngineRole,
  createBrivenEngineRole,
  getBrivenEngineUserRoles,
  listBrivenEngineRoles,
  userHasPermission,
} from './roles.js';

/**
 * Phase 6 — roles service closed when engine not bootstrapped.
 * Full create/list/assign runs in local Doltgres proof (engine init).
 */
describe('briven-engine roles (Phase 6, engine off)', () => {
  test('list returns empty shell when engine not ready', async () => {
    const r = await listBrivenEngineRoles();
    expect(r.engine).toBe('briven-engine');
    expect(r.storage).toBe('doltgres');
    expect(Array.isArray(r.roles)).toBe(true);
  });

  test('create fails closed when engine not ready', async () => {
    const r = await createBrivenEngineRole('admin', ['read']);
    expect(r.ok).toBe(false);
    expect(r.engine).toBe('briven-engine');
  });

  test('assign fails closed when engine not ready', async () => {
    const r = await assignBrivenEngineRole('beu_x', 'admin');
    expect(r.ok).toBe(false);
  });

  test('user roles empty when engine not ready', async () => {
    const r = await getBrivenEngineUserRoles('beu_x');
    expect(r.roles).toEqual([]);
    expect(r.permissions).toEqual([]);
  });

  test('userHasPermission false when engine not ready', async () => {
    expect(await userHasPermission('beu_x', 'read')).toBe(false);
  });
});

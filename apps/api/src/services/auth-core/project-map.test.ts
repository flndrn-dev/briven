import { describe, expect, test } from 'bun:test';

import {
  AUTH_CORE_DEFAULT_APP_ID,
  mapProjectToAuthCore,
  projectIdToTenantId,
  tenantIdToProjectId,
} from './project-map.js';

describe('briven-engine project map', () => {
  test('maps project id to tenant', () => {
    const m = mapProjectToAuthCore('p_abc123');
    expect(m.appId).toBe(AUTH_CORE_DEFAULT_APP_ID);
    // Core: letters, numbers, hyphens only
    expect(m.tenantId).toBe('proj-p-abc123');
    expect(m.projectId).toBe('p_abc123');
    expect(m.phase).toBe(1);
  });

  test('sanitizes weird project ids', () => {
    expect(projectIdToTenantId('My Project!')).toBe('proj-my-project');
  });

  test('tenant id has no underscores', () => {
    expect(projectIdToTenantId('p_hello_world')).toBe('proj-p-hello-world');
    expect(projectIdToTenantId('p_hello_world').includes('_')).toBe(false);
  });

  test('round-trips tenant → project (hyphen form)', () => {
    const t = projectIdToTenantId('p_xyz');
    expect(tenantIdToProjectId(t)).toBe('p-xyz');
  });

  test('rejects empty', () => {
    expect(() => projectIdToTenantId('   ')).toThrow();
  });
});

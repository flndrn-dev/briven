import { describe, expect, test } from 'bun:test';

import { resolveAuthTenantFromHeaders } from './request-tenant.js';
import { projectIdToTenantId } from './project-map.js';

describe('briven-engine request tenant', () => {
  test('maps x-briven-project-id', () => {
    const t = resolveAuthTenantFromHeaders((n) =>
      n === 'x-briven-project-id' ? 'p_hello' : undefined,
    );
    expect(t).not.toBeNull();
    expect(t!.engine).toBe('briven-engine');
    expect(t!.tenantId).toBe('proj-p-hello');
    expect(t!.projectId).toBe('p_hello');
  });

  test('null without header', () => {
    expect(resolveAuthTenantFromHeaders(() => undefined)).toBeNull();
  });

  test('tenant id is stable for login routing', () => {
    const a = projectIdToTenantId('p_abc');
    const b = projectIdToTenantId('p_abc');
    expect(a).toBe(b);
    expect(a.startsWith('proj-')).toBe(true);
    expect(a.includes('_')).toBe(false);
  });
});

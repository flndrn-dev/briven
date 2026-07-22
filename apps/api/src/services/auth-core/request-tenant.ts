/**
 * Resolve briven-engine tenant from request headers.
 *
 * Apps send `x-briven-project-id`. We map to tenantId for Multitenancy.
 */

import { mapProjectToAuthCore } from './project-map.js';

export type ResolvedAuthTenant = {
  projectId: string;
  appId: string;
  tenantId: string;
  engine: 'briven-engine';
};

export function resolveAuthTenantFromHeaders(
  getHeader: (name: string) => string | undefined,
): ResolvedAuthTenant | null {
  const projectId =
    getHeader('x-briven-project-id') ??
    getHeader('x-project-id') ??
    getHeader('briven-project-id');
  if (!projectId || !projectId.trim()) return null;
  try {
    const map = mapProjectToAuthCore(projectId.trim());
    return {
      projectId: map.projectId,
      appId: map.appId,
      tenantId: map.tenantId,
      engine: 'briven-engine',
    };
  } catch {
    return null;
  }
}

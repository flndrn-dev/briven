/**
 * Briven projectId → briven-engine app/tenant map (Path A).
 *
 * Phase 1: pure mapping rules (no Multitenancy recipe yet).
 * Later: Multitenancy creates tenants in briven-engine; this stays the source of truth
 * for which Briven project owns which engine tenant.
 *
 * Isolation rule: one Briven project = one tenantId under app "public"
 * (default app until Phase 6 enterprise apps).
 */

const ST_APP_ID = 'public';

/**
 * Normalize project id into a briven-engine-safe tenant id.
 * Core allows only letters, numbers, hyphens (no underscores).
 */
export function projectIdToTenantId(projectId: string): string {
  const cleaned = projectId
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!cleaned) {
    throw new Error('projectId is empty');
  }
  return `proj-${cleaned}`.slice(0, 64);
}

export function tenantIdToProjectId(tenantId: string): string | null {
  if (!tenantId.startsWith('proj-')) return null;
  // Reverse hyphenation is lossy for original underscores; store projectId separately in product.
  return tenantId.slice('proj-'.length);
}

export type AuthCoreProjectMap = {
  projectId: string;
  appId: typeof ST_APP_ID;
  tenantId: string;
  phase: 1;
};

export function mapProjectToAuthCore(projectId: string): AuthCoreProjectMap {
  return {
    projectId,
    appId: ST_APP_ID,
    tenantId: projectIdToTenantId(projectId),
    phase: 1,
  };
}

export const AUTH_CORE_DEFAULT_APP_ID = ST_APP_ID;

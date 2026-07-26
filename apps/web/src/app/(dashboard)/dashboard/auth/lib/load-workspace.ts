import { apiFetch, apiJson } from '../../../../../lib/api';

import type { AuthV2ProjectRow } from './auth-v2-types';

/**
 * Server-side load of Auth workspace (all projects + enable flags).
 * Prefers briven-engine `/v1/auth-core/workspace`, then merges tenants list
 * so "Auth on" never lags behind be_tenants.
 */
export async function loadAuthV2Workspace(): Promise<AuthV2ProjectRow[]> {
  let projects: AuthV2ProjectRow[] = [];

  try {
    const data = await apiJson<{
      projects?: AuthV2ProjectRow[];
    }>(`/v1/auth-core/workspace?_=${Date.now()}`);
    if (data.projects?.length) projects = data.projects;
  } catch {
    /* fall through */
  }

  if (projects.length === 0) {
    try {
      const data = await apiJson<{
        projects?: AuthV2ProjectRow[];
      }>('/v1/auth-v2/workspace');
      if (data.projects?.length) projects = data.projects;
    } catch {
      /* fall through */
    }
  }

  if (projects.length === 0) {
    try {
      const data = await apiJson<{
        projects: Array<{ id: string; slug: string; name: string }>;
      }>('/v1/projects');
      projects = (data.projects ?? []).map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        authEnabled: false,
        tenantId: null,
        providers: null,
      }));
    } catch {
      return [];
    }
  }

  // Merge live *active* tenants (API excludes soft-disabled rows).
  // Active list is the source of truth for on/off so "disable Auth" cannot be
  // flipped back on just because the tenant row still exists in the database.
  try {
    const res = await apiFetch('/v1/auth-core/tenants');
    if (res.ok) {
      const body = (await res.json()) as {
        tenants?: Array<{
          projectId?: string;
          tenantId?: string;
          authEnabled?: boolean;
        }>;
        tenantIds?: string[];
      };
      const byProject = new Map<string, string>();
      const tenantSet = new Set<string>();
      for (const t of body.tenants ?? []) {
        if (t.authEnabled === false) continue;
        if (t.tenantId) tenantSet.add(t.tenantId);
        if (t.projectId) {
          byProject.set(t.projectId, t.tenantId ?? '');
          byProject.set(t.projectId.toLowerCase(), t.tenantId ?? '');
        }
      }
      for (const tid of body.tenantIds ?? []) tenantSet.add(tid);

      const activeListLoaded =
        (body.tenants?.length ?? 0) > 0 || (body.tenantIds?.length ?? 0) > 0;

      projects = projects.map((p) => {
        const tid =
          byProject.get(p.id) ||
          byProject.get(p.id.toLowerCase()) ||
          p.tenantId ||
          null;
        // Map rule: tenant id is always proj-{normalized project id}
        const mapped = `proj-${p.id
          .trim()
          .toLowerCase()
          .replace(/_/g, '-')
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')}`.slice(0, 64);
        const activeTenant =
          byProject.has(p.id) ||
          byProject.has(p.id.toLowerCase()) ||
          (mapped ? tenantSet.has(mapped) : false) ||
          (p.tenantId ? tenantSet.has(p.tenantId) : false);

        // If we have an active-tenants list, it wins (soft-disable safe).
        // If the list is empty (no Auth anywhere, or total outage), keep workspace.
        const on = activeListLoaded
          ? activeTenant
          : p.authEnabled === true || activeTenant;

        return {
          ...p,
          authEnabled: on,
          tenantId: on ? tid || mapped || p.tenantId || null : null,
        };
      });
    }
  } catch {
    /* keep projects as-is */
  }

  return projects;
}

import { apiJson } from '../../../../../lib/api';

import type { AuthV2ProjectRow } from './auth-v2-types';

/**
 * Server-side load of Auth workspace (all projects + enable flags).
 * Prefers briven-engine `/v1/auth-core/workspace`, then auth-v2 bridge,
 * then plain projects (all Auth off).
 */
export async function loadAuthV2Workspace(): Promise<AuthV2ProjectRow[]> {
  try {
    const data = await apiJson<{
      projects?: AuthV2ProjectRow[];
    }>('/v1/auth-core/workspace');
    if (data.projects) return data.projects;
  } catch {
    /* fall through */
  }

  try {
    const data = await apiJson<{
      projects?: AuthV2ProjectRow[];
    }>('/v1/auth-v2/workspace');
    if (data.projects) return data.projects;
  } catch {
    /* fall through */
  }

  try {
    const data = await apiJson<{
      projects: Array<{ id: string; slug: string; name: string }>;
    }>('/v1/projects');
    return (data.projects ?? []).map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      authEnabled: false,
      providers: null,
    }));
  } catch {
    return [];
  }
}

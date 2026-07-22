import { apiJson } from '../../../../../lib/api';

import type { AuthV2ProjectRow, AuthV2Workspace } from './auth-v2-types';

/**
 * Server-side load of Auth workspace (all projects + enable flags).
 * Falls back to plain projects list (Auth off) if the Auth workspace API
 * is unavailable — so the card grid still shows something useful.
 */
export async function loadAuthV2Workspace(): Promise<AuthV2ProjectRow[]> {
  try {
    const data = await apiJson<AuthV2Workspace>('/v1/auth-v2/workspace');
    if (data.projects?.length) return data.projects;
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

import { apiJson } from '../../../../../lib/api';

import type { AuthV2ProjectRow, AuthV2Workspace } from './auth-v2-types';

/**
 * Server-side load of Auth v2 workspace (all projects + enable flags).
 * Failures return [] so the yellow UI still renders (empty state).
 */
export async function loadAuthV2Workspace(): Promise<AuthV2ProjectRow[]> {
  try {
    const data = await apiJson<AuthV2Workspace>('/v1/auth-v2/workspace');
    return data.projects ?? [];
  } catch {
    return [];
  }
}

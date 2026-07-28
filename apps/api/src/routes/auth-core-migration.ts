/**
 * briven-engine migration API (Phase 7 surface).
 *
 *  POST /v1/auth-core/migration/users
 */

import { Hono } from 'hono';

import { requireAuthCoreDashboard } from '../middleware/auth-core-guard.js';
import { requireDashboardProjectAdmin } from '../services/auth-core/dashboard-project-auth.js';
import { BRIVEN_ENGINE_ID } from '../services/auth-core/engine.js';
import {
  importBrivenEngineUsers,
  type ImportUserInput,
} from '../services/auth-core/migration.js';
import type { AppEnv } from '../types/app-env.js';

export const authCoreMigrationRouter = new Hono<AppEnv>();

authCoreMigrationRouter.use(
  '/v1/auth-core/migration/*',
  requireAuthCoreDashboard(),
);

authCoreMigrationRouter.post('/v1/auth-core/migration/users', async (c) => {
  let body: { users?: ImportUserInput[]; projectId?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (!Array.isArray(body.users) || body.users.length === 0) {
    return c.json(
      {
        engine: BRIVEN_ENGINE_ID,
        code: 'users_array_required',
        message: 'Body must be { users: [...], projectId?: "p_…" }',
      },
      400,
    );
  }
  if (body.users.length > 500) {
    return c.json(
      {
        engine: BRIVEN_ENGINE_ID,
        code: 'batch_too_large',
        message: 'Max 500 users per request',
      },
      400,
    );
  }
  // Stamp top-level projectId onto rows that omit it (dashboard migration UX).
  const projectGate = await requireDashboardProjectAdmin(c, body.projectId);
  if (projectGate instanceof Response) return projectGate;
  const projectId = projectGate.projectId;
  const users = body.users.map((u) => ({
    ...u,
    projectId: u.projectId ?? projectId,
  }));
  // Reject rows that try to import into a different project.
  if (users.some((u) => u.projectId && u.projectId !== projectId)) {
    return c.json(
      {
        engine: BRIVEN_ENGINE_ID,
        code: 'project_mismatch',
        message: 'all users must target the same projectId as the request',
      },
      403,
    );
  }
  const result = await importBrivenEngineUsers(users);
  return c.json(result, result.ok ? 200 : 503);
});

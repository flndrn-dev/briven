import { Hono } from 'hono';

import { projectRateLimit } from '../middleware/rate-limit.js';
import { requireProjectAuth, requireProjectRole } from '../middleware/project-auth.js';
import { buildProjectExport } from '../services/export-import.js';
import type { ProjectAppEnv as AppEnv } from '../types/app-env.js';

/**
 * Project export — returns the schema + functions of the project's
 * current deployment as a single JSON document. Admin-tier (the export
 * includes function source code, which can contain inline secrets if the
 * project author hasn't been disciplined). Rate-limited under `mutate`.
 */
export const exportRouter = new Hono<AppEnv>();

exportRouter.use('/v1/projects/:id/export', requireProjectAuth());

exportRouter.get(
  '/v1/projects/:id/export',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const out = await buildProjectExport(c.req.param('id'));
    return c.json(out);
  },
);

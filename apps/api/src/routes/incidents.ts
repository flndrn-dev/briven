import { Hono } from 'hono';

import { listIncidents } from '../services/incidents.js';
import type { AppEnv } from '../types/app-env.js';

/**
 * Public status feed — no auth, no rate limit. Returns recent incidents
 * for status pages + RSS feed consumption. Admin write surface lives
 * on adminRouter (so it inherits requireAuth + requireAdmin + step-up).
 */
export const incidentsRouter = new Hono<AppEnv>();

incidentsRouter.get('/v1/status/incidents', async (c) => {
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Math.min(100, Math.max(1, Number(limitParam) || 50)) : 50;
  const activeOnly = c.req.query('active') === 'true';
  const rows = await listIncidents({ limit, activeOnly });
  return c.json({ incidents: rows });
});

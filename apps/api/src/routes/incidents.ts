import { Hono } from 'hono';

import { listIncidents } from '../services/incidents.js';
import { getMaintenanceState } from '../services/platform-settings.js';
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

/**
 * Public maintenance state — no auth, no rate limit. Returns the effective
 * maintenance state so the marketing site can render a scheduled/active/
 * upcoming banner. Reachable during maintenance via the /v1/status/*
 * whitelist in the maintenance middleware.
 */
incidentsRouter.get('/v1/status/maintenance', async (c) => {
  return c.json(await getMaintenanceState());
});

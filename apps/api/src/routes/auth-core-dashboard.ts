/**
 * Yellow Authentication dashboard aggregate (Doltgres).
 *
 *  GET /v1/auth-core/dashboard — counts + recent users + methods
 *  Requires platform dashboard session.
 */

import { Hono } from 'hono';

import { requireAuthCoreDashboard } from '../middleware/auth-core-guard.js';
import { getBrivenEngineDashboard } from '../services/auth-core/dashboard.js';
import type { AppEnv } from '../types/app-env.js';

export const authCoreDashboardRouter = new Hono<AppEnv>();

authCoreDashboardRouter.use(
  '/v1/auth-core/dashboard',
  requireAuthCoreDashboard(),
);

authCoreDashboardRouter.get('/v1/auth-core/dashboard', async (c) => {
  const data = await getBrivenEngineDashboard();
  return c.json(data);
});

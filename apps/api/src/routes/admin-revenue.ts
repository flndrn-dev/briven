import { Hono } from 'hono';

import { requireAdmin } from '../middleware/admin.js';
import { requireAuth } from '../middleware/session.js';
import type { AppEnv } from '../types/app-env.js';
import { getAdminRevenue } from '../services/admin-revenue.js';

/**
 * DEEP admin revenue endpoint. Read-only, so it takes the reads-no-step-up
 * guard chain (requireAuth + requireAdmin) — same as the other admin GETs.
 * Payload is a CONTRACT with the web revenue page (see services/admin-revenue.ts
 * AdminRevenue). Real subscriptions + usage_events; MRR null until Mavi Pay is
 * wired.
 */
export const adminRevenueRouter = new Hono<AppEnv>();

adminRevenueRouter.use('/v1/admin/revenue', requireAuth());
adminRevenueRouter.use('/v1/admin/revenue', requireAdmin());

adminRevenueRouter.get('/v1/admin/revenue', async (c) => c.json(await getAdminRevenue()));

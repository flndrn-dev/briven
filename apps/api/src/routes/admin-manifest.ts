import { constantTimeEqual } from '@briven/shared';
import { Hono } from 'hono';

import { env } from '../env.js';
import { BUILD_AT, BUILD_SHA } from './health.js';
import { adminStats, listProjects, listUsers } from '../services/admin.js';

/**
 * admin.flndrn.com dashboard API. This is the cross-product operator
 * console at admin.flndrn.com probing briven as one of its registered
 * child projects — distinct from the in-product operator dashboard
 * served by routes/admin.ts (session + step-up MFA at /v1/admin/*).
 *
 * Contract (confirmed against the admin.flndrn.com consumer):
 *   GET /api/admin/v1/manifest  Bearer  → 200 { sections: [...] }
 *   GET /api/admin/v1/ping      Bearer  → 200 { ok: true }
 *   GET /api/admin/v1/summary   Bearer  → 200 KPIs
 *   GET /api/admin/v1/users     Bearer  → 200 { users: [...] }
 *   GET /api/admin/v1/projects  Bearer  → 200 { projects: [...] }
 * `/api/admin/*` is mounted as an alias so the consumer's v1-then-bare
 * fallback resolves to the same handlers.
 *
 * Auth: a single shared bearer key in BRIVEN_ADMIN_API_KEY, compared in
 * constant time (mirrors routes/internal.ts). The value must equal the
 * key admin.flndrn.com has registered for briven. Fails safe:
 *   - key unset            → 503 admin_not_configured (never crashes)
 *   - missing/wrong bearer → 401 unauthorized
 * No DB or platform state is touched before the auth gate, so an
 * unauthenticated probe of any route returns 401 (the consumer's
 * security-gate test) without a query running.
 */
export const adminManifestRouter = new Hono();

/**
 * Sections the manifest advertises. Every entry here is backed by a list
 * (or summary) endpoint implemented below with a REAL query — no
 * placeholders. Snapshots/usage are intentionally absent: briven stores
 * snapshots per-project inside each tenant's data-plane schema and has
 * no cross-project recent-snapshots query to back a single list endpoint,
 * so advertising one would mean faking data.
 */
const SECTIONS = [
  {
    key: 'summary',
    title: 'Overview',
    icon: 'dashboard',
    description: 'Top-line platform counts: users, projects, deployments, open work.',
    permission: 'dev.briven.read',
    endpoints: [{ kind: 'detail', method: 'GET', path: '/api/admin/v1/summary' }],
  },
  {
    key: 'users',
    title: 'Users',
    icon: 'groups',
    description: 'Registered briven accounts with project counts and status.',
    permission: 'dev.briven.read',
    endpoints: [{ kind: 'list', method: 'GET', path: '/api/admin/v1/users' }],
  },
  {
    key: 'projects',
    title: 'Projects',
    icon: 'inventory_2',
    description: 'Active briven projects with tier and owning org.',
    permission: 'dev.briven.read',
    endpoints: [{ kind: 'list', method: 'GET', path: '/api/admin/v1/projects' }],
  },
] as const;

/**
 * Bearer gate. Returns 503 when the key is unset (fail-safe: the routes
 * simply aren't usable yet, the process never crashes) and 401 on a
 * missing or wrong token. Ordered key-first so an unconfigured deploy and
 * an unauthenticated probe are both answered before any handler runs.
 */
adminManifestRouter.use('/api/admin/*', async (c, next) => {
  const expected = env.BRIVEN_ADMIN_API_KEY;
  if (!expected) {
    return c.json({ code: 'admin_not_configured', message: 'admin API not configured' }, 503);
  }
  const auth = c.req.header('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
  if (!token || !constantTimeEqual(token, expected)) {
    return c.json({ code: 'unauthorized', message: 'unauthorized' }, 401);
  }
  await next();
  return;
});

adminManifestRouter.get('/api/admin/v1/manifest', (c) => c.json({ sections: SECTIONS }));
adminManifestRouter.get('/api/admin/manifest', (c) => c.json({ sections: SECTIONS }));

adminManifestRouter.get('/api/admin/v1/ping', (c) =>
  c.json({ ok: true, service: 'briven', ts: new Date().toISOString() }),
);
adminManifestRouter.get('/api/admin/ping', (c) =>
  c.json({ ok: true, service: 'briven', ts: new Date().toISOString() }),
);

/**
 * Top-line KPIs. Reuses services/admin.ts adminStats() verbatim — the
 * same rollups the in-product operator dashboard renders — plus the
 * running build identity so the dashboard can show what's deployed.
 */
adminManifestRouter.get('/api/admin/v1/summary', async (c) => {
  const stats = await adminStats();
  return c.json({
    service: 'briven',
    buildSha: BUILD_SHA,
    buildAt: BUILD_AT === 'dev' ? null : BUILD_AT,
    env: env.BRIVEN_ENV,
    ...stats,
  });
});

/**
 * Users list — capped at 200, newest first. Reuses listUsers() so the
 * shape (id, email, name, emailVerified, isAdmin, suspendedAt, createdAt,
 * projectCount) matches the in-product admin users page exactly.
 */
adminManifestRouter.get('/api/admin/v1/users', async (c) => {
  const rows = await listUsers(200);
  return c.json({ users: rows });
});

/**
 * Projects list — capped at 500, newest first. Reuses listProjects().
 */
adminManifestRouter.get('/api/admin/v1/projects', async (c) => {
  const rows = await listProjects(500);
  return c.json({ projects: rows });
});

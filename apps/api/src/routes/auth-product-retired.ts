/**
 * Customer Auth product paths that stay closed (Option B Phase 1).
 * Status shell is mounted separately: GET /v1/auth-core/info|ready|map.
 * Does NOT touch platform operator login (`/v1/auth/*` Better Auth).
 */

import { Hono } from 'hono';

import type { AppEnv } from '../types/app-env.js';

export const authProductRetiredRouter = new Hono<AppEnv>();

const GONE = {
  code: 'auth_product_path_closed',
  message:
    'This Auth dashboard path is not open yet. App login uses /v1/auth-core/fdi/*. Platform sign-in (briven.tech) is unchanged.',
  product: 'Briven Auth',
  engine: 'briven-engine',
} as const;

// Old Better Auth multi-tenant customer product
authProductRetiredRouter.all('/v1/auth-tenant/*', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-v2/*', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/projects/:id/auth/*', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/projects/:id/scim/*', (c) => c.json(GONE, 410));

// Phase 7 opens: dashboard, users, roles, sessions, workspace, project config,
// keys, tenants. Still closed: legacy recipes admin, MFA admin-only helpers,
// migration bulk (deep enterprise login comes later).
authProductRetiredRouter.all('/v1/auth-core/recipes', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-core/recipes/*', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-core/mfa/*', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-core/passkeys/*', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-core/migration/*', (c) => c.json(GONE, 410));

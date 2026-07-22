/**
 * Customer Auth product paths that stay closed (Option B Phase 1).
 * Status shell is mounted separately: GET /v1/auth-core/info|ready|map.
 * Does NOT touch platform operator login (`/v1/auth/*` Better Auth).
 */

import { Hono } from 'hono';

import type { AppEnv } from '../types/app-env.js';

export const authProductRetiredRouter = new Hono<AppEnv>();

const GONE = {
  code: 'auth_product_not_open',
  message:
    'Briven Auth is not open for app login yet (Phase 1 shell only). Platform sign-in (briven.tech) is unchanged.',
  product: 'Briven Auth',
  engine: 'briven-engine',
  appLoginReady: false,
} as const;

// Old Better Auth multi-tenant customer product
authProductRetiredRouter.all('/v1/auth-tenant/*', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-v2/*', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/projects/:id/auth/*', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/projects/:id/scim/*', (c) => c.json(GONE, 410));

// Phase 2 opens: /v1/auth-core/fdi/* (password login) + /v1/auth-core/session/me
// Still closed: dashboard product, users list, MFA admin, keys, migration, …
authProductRetiredRouter.all('/v1/auth-core/dashboard', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-core/dashboard/*', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-core/users', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-core/users/*', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-core/recipes', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-core/recipes/*', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-core/workspace', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-core/projects/*', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-core/tenants', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-core/tenants/*', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-core/roles', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-core/roles/*', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-core/mfa/*', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-core/passkeys/*', (c) => c.json(GONE, 410));
// session list/revoke stay dashboard-gated on the session router; no blanket 410 on /session/*
authProductRetiredRouter.all('/v1/auth-core/keys/*', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-core/migration/*', (c) => c.json(GONE, 410));

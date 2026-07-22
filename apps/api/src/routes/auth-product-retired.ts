/**
 * Customer Auth product is blank / retired until SuperTokens-on-Doltgres build.
 * Always mounted. Does NOT touch platform operator login (`/v1/auth/*` Better Auth).
 */

import { Hono } from 'hono';

import type { AppEnv } from '../types/app-env.js';

export const authProductRetiredRouter = new Hono<AppEnv>();

const GONE = {
  code: 'auth_product_blank',
  message:
    'Briven Auth product is blank while SuperTokens on Doltgres is built. Platform sign-in (briven.tech) is unchanged.',
  product: 'Briven Auth',
} as const;

// Old Better Auth multi-tenant customer product
authProductRetiredRouter.all('/v1/auth-tenant/*', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/auth-v2/*', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/projects/:id/auth/*', (c) => c.json(GONE, 410));
authProductRetiredRouter.all('/v1/projects/:id/scim/*', (c) => c.json(GONE, 410));

// Native briven-engine product surface (not SuperTokens) — off during blank
authProductRetiredRouter.all('/v1/auth-core/*', (c) => c.json(GONE, 410));

/**
 * Briven Auth v2 dashboard API — SuperTokens-style workspace ops.
 * Mounted at /v1/auth-v2/*
 *
 * Phase 1: list projects, save providers with read-back proof, project snapshot.
 * Runtime login still uses /v1/auth-tenant (Better Auth pool) until full engine swap.
 */

import { Hono } from 'hono';

import { ValidationError } from '@briven/shared';

import { requireAuth } from '../middleware/session.js';
import { requireProjectAuth, requireProjectRole } from '../middleware/project-auth.js';
import { requireAuthTeamAdmin } from '../middleware/auth-team.js';
import {
  getAuthV2ProjectSnapshot,
  hasAtLeastOneProvider,
  listAuthV2Workspace,
  saveAuthV2Providers,
} from '../services/auth-v2-workspace.js';
import type { AppEnv } from '../types/app-env.js';

export const authV2Router = new Hono<AppEnv>();

authV2Router.use('/v1/auth-v2/*', requireAuth());

/**
 * GET /v1/auth-v2/workspace
 * All projects for the signed-in user + Auth enable + core provider flags.
 */
authV2Router.get('/v1/auth-v2/workspace', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ code: 'unauthorized' }, 401);
  const workspace = await listAuthV2Workspace(user.id);
  return c.json({
    ok: true,
    phase: 1,
    engine: 'briven-auth-v2',
    note: 'login runtime still /v1/auth-tenant; dashboard config is Auth v2',
    ...workspace,
  });
});

authV2Router.use('/v1/auth-v2/projects/:id/*', requireProjectAuth());
authV2Router.use('/v1/auth-v2/projects/:id/*', requireAuthTeamAdmin());

/**
 * GET /v1/auth-v2/projects/:id/snapshot
 */
authV2Router.get(
  '/v1/auth-v2/projects/:id/snapshot',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);
    try {
      const snap = await getAuthV2ProjectSnapshot(projectId);
      return c.json({ ok: true, projectId, ...snap });
    } catch (err) {
      return c.json(
        {
          code: 'snapshot_failed',
          message: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }
  },
);

/**
 * PUT /v1/auth-v2/projects/:id/providers
 * Body: { emailPassword, magicLink, emailOtp, passkey } booleans.
 * Returns live providers after re-read (save-sticks proof).
 */
authV2Router.put(
  '/v1/auth-v2/projects/:id/providers',
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    if (!projectId) return c.json({ code: 'validation_failed', message: 'missing :id' }, 400);

    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return c.json({ code: 'validation_failed', message: 'body must be JSON' }, 400);
    }

    const flags = {
      emailPassword: body.emailPassword === true,
      magicLink: body.magicLink === true,
      emailOtp: body.emailOtp === true,
      passkey: body.passkey === true,
    };

    if (!hasAtLeastOneProvider(flags)) {
      return c.json(
        {
          code: 'validation_failed',
          message: 'turn on at least one method (password, magic link, OTP, or passkey)',
        },
        400,
      );
    }

    try {
      const result = await saveAuthV2Providers(projectId, flags);
      return c.json({
        ok: true,
        projectId,
        saved: true,
        savedAt: new Date().toISOString(),
        enabled: result.enabled,
        providers: result.providers,
        // proof: what DB returns after invalidate
        proof: result.providers,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'auth_not_enabled') {
        return c.json(
          {
            code: 'auth_not_enabled',
            message: 'enable Auth for this project first',
          },
          400,
        );
      }
      if (err instanceof ValidationError) {
        return c.json({ code: 'validation_failed', message: err.message }, 400);
      }
      return c.json({ code: 'save_failed', message: msg }, 500);
    }
  },
);

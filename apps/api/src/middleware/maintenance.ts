import type { MiddlewareHandler } from 'hono';

import { getMaintenanceState } from '../services/platform-settings.js';

/**
 * Platform-wide maintenance gate. Gates on the EFFECTIVE maintenance
 * state (manual `maintenanceMode` override OR an active scheduled
 * `maintenanceWindow`) — see getMaintenanceState(). When active, every
 * request returns 503 except a small whitelist:
 *   - /health, /ready (so the operator + monitoring still see liveness)
 *   - /v1/auth/*       (Better Auth — admin must be able to sign in)
 *   - /v1/me, /v1/me/* (the signed-in admin needs /me + /me/step-up)
 *   - /v1/admin/*      (admin actions, including the toggle to flip
 *                       maintenance mode back off)
 *   - /v1/status/*     (public status feed — incidents + maintenance
 *                       state — MUST stay reachable so the marketing
 *                       site can render the maintenance page)
 *
 * The flag lives in platform_settings (DB-backed, 60s cached) so an
 * admin can flip it from the dashboard without an env change or
 * deploy. Cache TTL means the change takes effect within ~60s on peer
 * instances and immediately on the writer.
 *
 * Mounted at app level on /v1/* AFTER attachSession + before any
 * project-scoped middleware, so /health (no /v1 prefix) is naturally
 * exempt and Better Auth's /v1/auth/* responds normally for the
 * sign-in path.
 */
export function maintenanceMode(): MiddlewareHandler {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (isWhitelisted(path)) {
      await next();
      return;
    }
    const state = await getMaintenanceState();
    if (!state.active) {
      await next();
      return;
    }
    return c.json(
      {
        code: 'maintenance_mode',
        message:
          'briven is in maintenance mode. critical paths (auth, /health, /ready, admin) remain available.',
      },
      503,
    );
  };
}

function isWhitelisted(path: string): boolean {
  if (path === '/health' || path === '/ready') return true;
  if (path.startsWith('/v1/auth/')) return true;
  if (path === '/v1/me' || path.startsWith('/v1/me/')) return true;
  if (path.startsWith('/v1/admin/')) return true;
  // Public status feed (incidents + maintenance state). Kept open so the
  // marketing site can read maintenance state to render its status page
  // DURING maintenance — otherwise the web can't discover the window.
  if (path.startsWith('/v1/status/')) return true;
  // /info is the build-info probe used by the dashboard footer. Keep
  // it open so the operator's own dashboard renders during maintenance.
  if (path === '/info') return true;
  return false;
}

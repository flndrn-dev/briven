import { constantTimeEqual } from '@briven/shared';
import { Hono } from 'hono';

import { env } from '../env.js';
import { resolveApiKey } from '../services/api-keys.js';
import { getDeployment, getDeploymentBundle } from '../services/deployments.js';
import { invoke } from '../services/invoke.js';
import { getPlainEnvForProject } from '../services/project-env.js';
import { getProjectTier, TIERS } from '../services/tiers.js';
import { runDueAutoSnapshots } from '../workers/auto-snapshot.js';

/**
 * Internal endpoints — only the runtime host calls these, authenticated via
 * BRIVEN_RUNTIME_SHARED_SECRET. Never exposed to the public dashboard or
 * the customer SDK.
 */
export const internalRouter = new Hono();

internalRouter.use('/v1/internal/*', async (c, next) => {
  const expected = env.BRIVEN_RUNTIME_SHARED_SECRET;
  if (!expected) return c.json({ code: 'not_configured', message: 'runtime secret missing' }, 503);
  const auth = c.req.header('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
  if (!token || !constantTimeEqual(token, expected)) {
    return c.json({ code: 'unauthorized' }, 401);
  }
  await next();
  return;
});

internalRouter.post('/v1/internal/projects/:projectId/verify-key', async (c) => {
  // Realtime asks whether a project key (brk_…) is valid FOR this project, so a
  // browser's WebSocket token only ever opens its own project. apps/api owns
  // the api-key table, so the check lives here (reuses resolveApiKey, the same
  // resolver requireProjectAuth uses).
  const projectId = c.req.param('projectId');
  const body = (await c.req.json().catch(() => null)) as { token?: string } | null;
  const token = body?.token;
  if (!token || !token.startsWith('brk_')) return c.json({ valid: false });
  const resolved = await resolveApiKey(token);
  return c.json({ valid: !!resolved && resolved.projectId === projectId });
});

internalRouter.get('/v1/internal/deployments/:projectId/:deploymentId/bundle', async (c) => {
  // The projectId is included in the path so the runtime can verify the
  // deployment belongs to the project it thinks it does — defense in depth
  // against a runtime bug that could otherwise serve cross-project code.
  const projectId = c.req.param('projectId');
  const deploymentId = c.req.param('deploymentId');

  const deployment = await getDeployment(projectId, deploymentId);
  const bundle = await getDeploymentBundle(deploymentId);
  return c.json({
    deploymentId: deployment.id,
    projectId: deployment.projectId,
    functionNames: (deployment.functionNames as string[] | null) ?? [],
    bundle: bundle ?? {},
  });
});

/**
 * Decrypted env vars for a project — consumed by the runtime when spawning
 * an isolate. Body is a flat `{ KEY: "value", ... }` object. The shared
 * secret middleware above is the only auth; never expose this on a path
 * the dashboard or SDK can reach.
 */
internalRouter.get('/v1/internal/projects/:projectId/env', async (c) => {
  const projectId = c.req.param('projectId');
  const values = await getPlainEnvForProject(projectId);
  return c.json(values);
});

/**
 * Internal invoke for system callers (realtime fan-out). The public route
 * at /v1/projects/:id/functions/:name requires a session/api-key with
 * developer role; realtime holds neither — it authenticates as the runtime
 * via BRIVEN_RUNTIME_SHARED_SECRET (already gated above) and invokes on
 * behalf of an anonymous system identity. The invoke service threads
 * `auth: null` through to the runtime, which records the call in audit
 * logs as a system-originated invocation.
 */
internalRouter.post('/v1/internal/projects/:projectId/functions/:functionName', async (c) => {
  const projectId = c.req.param('projectId');
  const functionName = c.req.param('functionName');
  const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();

  const raw = await c.req.text();
  let args: unknown = null;
  if (raw.length > 0) {
    try {
      args = JSON.parse(raw);
    } catch {
      return c.json({ code: 'invalid_json', message: 'request body is not valid json' }, 400);
    }
  }

  const result = await invoke({
    projectId,
    functionName,
    args,
    requestId,
    auth: null,
  });
  // A function that ran but returned an error is a 422 (unprocessable) —
  // same as the public /invoke route — so the realtime caller can tell a
  // function-level failure apart from a 500 infra error. Only true infra
  // faults throw and surface as 5xx via the error handler.
  const status = result.ok ? 200 : 422;
  return c.json(result, status);
});

/**
 * Drive the auto-snapshot worker once on demand. The in-process timer
 * (workers/auto-snapshot.ts, armed at boot) is the primary trigger; this
 * endpoint lets an external scheduler (e.g. a system cron hitting the API
 * over the internal network with BRIVEN_RUNTIME_SHARED_SECRET) run the due
 * scan in deployments that prefer cron over the in-process timer. Idempotent
 * and safe to call alongside the timer — the per-project claim guard prevents
 * any project being snapshotted twice for the same slot.
 *
 *   curl -XPOST -H "authorization: Bearer $BRIVEN_RUNTIME_SHARED_SECRET" \
 *     https://api.internal/v1/internal/auto-snapshots/run
 */
internalRouter.post('/v1/internal/auto-snapshots/run', async (c) => {
  const summary = await runDueAutoSnapshots(new Date());
  return c.json({ ok: true, ...summary });
});

/**
 * Resolve a project's tier-aware limits. Used by the realtime service on
 * first subscribe per project to enforce TIERS.concurrentSubscriptions
 * instead of the platform-wide BRIVEN_REALTIME_MAX_SUBS_PER_PROJECT ceiling.
 * Returns `tier: null` when the project doesn't exist; callers treat null
 * as "deny by default" rather than falling back to the platform cap.
 */
internalRouter.get('/v1/internal/projects/:projectId/limits', async (c) => {
  const projectId = c.req.param('projectId');
  const tier = await getProjectTier(projectId);
  if (!tier) {
    return c.json({ projectId, tier: null, limits: null });
  }
  const limits = TIERS[tier];
  return c.json({
    projectId,
    tier,
    limits: {
      concurrentSubscriptions: limits.concurrentSubscriptions,
      invokesPerMonth: limits.invokesPerMonth,
      storageBytes: limits.storageBytes,
      connectionSecondsPerMonth: limits.connectionSecondsPerMonth,
    },
  });
});

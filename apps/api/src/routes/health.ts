import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { Hono } from 'hono';

import { pingDb } from '../db/client.js';
import { pingDataPlane } from '../db/data-plane.js';
import { env } from '../env.js';
import { renderPrometheus } from '../lib/metrics.js';
import { pingRedis } from '../lib/redis.js';

export const BOOT_TIME = new Date().toISOString();
// Commit SHA + build timestamp surface in /info. Preferred source is the
// BRIVEN_BUILD_SHA Dockerfile ARG (passed by scripts/deploy-kvm4.sh).
// Fallback: read .git/HEAD inside the image — Dokploy's auto-deploy
// triggers a plain `docker compose build` without build-args, so without
// this branch /info would lie about which commit is live.
//
// "dev" is treated identically to undefined here because that's the ARG
// default in the Dockerfile — when Dokploy builds without a build-arg
// the ENV resolves to the literal string "dev", and we want the .git
// fallback to fire in that case too.
function envSha(): string | null {
  const v = process.env.BRIVEN_BUILD_SHA?.trim();
  return !v || v === 'dev' ? null : v;
}
function envAt(): string | null {
  const v = process.env.BRIVEN_BUILD_AT?.trim();
  return !v || v === 'dev' ? null : v;
}
export const BUILD_SHA = envSha() ?? resolveShaFromGit() ?? 'dev';
export const BUILD_AT = envAt() ?? resolveBuildAtFromGit() ?? 'dev';

export const healthRouter = new Hono();

/**
 * /health — process liveness. Never depends on anything external.
 * Per CLAUDE.md §5.5: health = process alive, ready = deps reachable.
 */
healthRouter.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'api',
    env: env.BRIVEN_ENV,
    bootedAt: BOOT_TIME,
  }),
);

/**
 * /ready — dependency readiness. Returns 200 only when every required
 * upstream is reachable (control-plane postgres, data-plane postgres,
 * runtime reachable from the swarm network).
 */
healthRouter.get('/ready', async (c) => {
  const [controlOk, dataOk, runtimeOk, redisOk] = await Promise.all([
    env.BRIVEN_DATABASE_URL ? pingDb() : Promise.resolve(false),
    env.BRIVEN_DATA_PLANE_URL ? pingDataPlane() : Promise.resolve(false),
    probeRuntime(),
    env.BRIVEN_REDIS_URL ? pingRedis() : Promise.resolve(false),
  ]);

  const checks = {
    control_postgres: env.BRIVEN_DATABASE_URL
      ? controlOk
        ? 'ok'
        : 'unreachable'
      : 'not_configured',
    data_plane_postgres: env.BRIVEN_DATA_PLANE_URL
      ? dataOk
        ? 'ok'
        : 'unreachable'
      : 'not_configured',
    runtime: runtimeOk ? 'ok' : 'unreachable',
    redis: env.BRIVEN_REDIS_URL ? (redisOk ? 'ok' : 'unreachable') : 'not_configured',
  } as const;

  // Redis powers logs streaming + rate limits. Required when configured;
  // unconfigured = dev mode where logs/limits silently no-op.
  const redisRequired = !!env.BRIVEN_REDIS_URL;
  const ready = controlOk && dataOk && runtimeOk && (!redisRequired || redisOk);
  return c.json({ status: ready ? 'ready' : 'not_ready', checks }, ready ? 200 : 503);
});

/**
 * /info — build + runtime metadata. Public (no auth) so:
 *   - `briven doctor` can show "running build abc1234 / booted 2h ago"
 *   - support can verify which commit a customer's deploy is on
 *   - the post-deploy CI gate can assert a fresh sha is live
 * Intentionally narrow — no secrets, no env-key listing.
 */
healthRouter.get('/info', (c) =>
  c.json({
    service: 'api',
    env: env.BRIVEN_ENV,
    buildSha: BUILD_SHA,
    buildAt: BUILD_AT,
    bootedAt: BOOT_TIME,
    uptimeSec: Math.floor(process.uptime()),
    domain: env.BRIVEN_DOMAIN ?? null,
  }),
);

/**
 * /metrics — Prometheus exposition. Intentionally unauthenticated; the
 * scraper runs on the same docker network and the host firewall is the
 * trust boundary. Per CLAUDE.md §11 every service exposes /metrics.
 */
healthRouter.get('/metrics', (c) =>
  c.text(renderPrometheus(), 200, {
    'content-type': 'text/plain; version=0.0.4; charset=utf-8',
  }),
);

async function probeRuntime(): Promise<boolean> {
  if (!env.BRIVEN_RUNTIME_URL) return false;
  try {
    const res = await fetch(`${env.BRIVEN_RUNTIME_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Read the commit sha from .git/HEAD without shelling out to `git`.
 * Handles three layouts:
 *   1. detached HEAD             — HEAD contains the sha directly
 *   2. ref pointing at a loose   — .git/refs/heads/<name> exists
 *   3. ref pointing at a packed  — entry lives in .git/packed-refs
 *
 * Returns null on any I/O failure so the caller can fall back to "dev".
 * Exported for tests.
 */
export function resolveShaFromGit(gitDir = resolve(process.cwd(), '../../.git')): string | null {
  try {
    const head = readFileSync(resolve(gitDir, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) return /^[0-9a-f]{40}$/.test(head) ? head : null;
    const ref = head.slice(4).trim();
    try {
      const sha = readFileSync(resolve(gitDir, ref), 'utf8').trim();
      if (/^[0-9a-f]{40}$/.test(sha)) return sha;
    } catch {
      // loose ref missing — try packed-refs
    }
    const packed = readFileSync(resolve(gitDir, 'packed-refs'), 'utf8');
    for (const line of packed.split('\n')) {
      if (line.startsWith('#') || line.startsWith('^')) continue;
      const [sha, name] = line.split(' ');
      if (name === ref && sha && /^[0-9a-f]{40}$/.test(sha)) return sha;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build timestamp fallback — when BRIVEN_BUILD_AT isn't passed at image
 * build time, we approximate it from the mtime of .git/HEAD. The mtime
 * is updated whenever HEAD moves (checkout / commit / fetch+reset), so
 * inside a freshly-built image it reflects when the docker build copied
 * the .git tree — which for an auto-deploy is within seconds of the
 * commit that triggered it. Good enough for /info's "when was this
 * built?" signal. Exported for tests.
 */
export function resolveBuildAtFromGit(
  gitDir = resolve(process.cwd(), '../../.git'),
): string | null {
  try {
    const stat = statSync(resolve(gitDir, 'HEAD'));
    return new Date(stat.mtimeMs).toISOString();
  } catch {
    return null;
  }
}

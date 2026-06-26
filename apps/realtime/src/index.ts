import { resolve } from 'node:path';

import { constantTimeEqual, resolveBuildIdentity } from '@briven/shared';
import { createLogger } from '@briven/shared/observability';
import { z } from 'zod';

import { env } from './env.js';
import { incCounter, registerGauge, renderPrometheus } from './metrics.js';
import { PollManager } from './poll-manager.js';
import { SubscriptionRegistry } from './subscription-registry.js';

const BOOT_TIME = new Date().toISOString();
// apps/realtime runs from /app/apps/realtime; the repo root is two
// levels up.
const { buildSha: BUILD_SHA, buildAt: BUILD_AT } = resolveBuildIdentity(
  resolve(process.cwd(), '../../.git'),
);

const log = createLogger({
  service: 'realtime',
  env: env.BRIVEN_ENV,
  level: env.BRIVEN_LOG_LEVEL,
});

/**
 * Reactive WebSocket service.
 *
 * Wire protocol (JSON frames over a single WS connection):
 *   client → server:
 *     {type:'subscribe', subscriptionId, projectId, functionName, args}
 *     {type:'unsubscribe', subscriptionId}
 *   server → client:
 *     {type:'hello', protocol:1}
 *     {type:'data', subscriptionId, ok, value | code/message, durationMs}
 *     {type:'unsubscribed', subscriptionId}
 *     {type:'error', code}
 *
 * Subscription lifecycle:
 *   1. Client subscribes → realtime calls apps/api invoke endpoint
 *   2. Response includes `touchedTables`; realtime watches those tables
 *      for changes (Phase 2: Dolt commit-diff polling)
 *   3. Change detected → realtime re-invokes every subscription that
 *      touched that table, sends a fresh `data` frame
 *   4. Unsubscribe / disconnect → drop the subscription, decrement channel
 *      refcounts, stop polling the project when its last channel is removed
 *
 * @README-BRIVEN Phase 2: Postgres LISTEN/NOTIFY replaced with DoltGres
 * commit-diff polling. The PollManager queries `DOLT_HASHOF('HEAD')`
 * for each active project at the configured interval; when the hash
 * changes it fires every channel belonging to that project.
 */

const subscribeSchema = z.object({
  type: z.literal('subscribe'),
  subscriptionId: z.string().min(1),
  projectId: z.string().min(1),
  functionName: z.string().min(1),
  args: z.unknown(),
});

const unsubscribeSchema = z.object({
  type: z.literal('unsubscribe'),
  subscriptionId: z.string().min(1),
});

const clientMessage = z.discriminatedUnion('type', [subscribeSchema, unsubscribeSchema]);

interface Subscription {
  subscriptionId: string;
  projectId: string;
  functionName: string;
  args: unknown;
  channels: Set<string>;
  send: (frame: Record<string, unknown>) => void;
  // Wall-clock ms at subscription open. Closed-out subs flush their
  // duration into closedSubSecondsByProject (cumulative billable
  // seconds-of-connection per project). Active subs contribute to the
  // pull-based gauge below — at scrape time we add (now - startedAt)
  // for every still-live sub so the metric never under-counts.
  startedAt: number;
}

const subscriptions = new Map<string, Subscription>(); // subscriptionId → sub
const registry = new SubscriptionRegistry(); // channel ↔ subId, ref-counted
const sockets = new WeakMap<object, Set<string>>(); // ws → set of subscriptionIds it owns
// projectId → live sub count. Maintained inline with the subscriptions
// map so the per-project cap can be enforced in O(1) without scanning.
const subsByProject = new Map<string, number>();

// Cumulative connection-seconds, per project, from subs that have
// already closed. Phase 3 usage-metering pillar #3 — Polar metering
// push reads this via /metrics. Kept in memory (resets on process
// restart); a durable rollup is the natural follow-up.
const closedSubSecondsByProject = new Map<string, number>();

/**
 * Tier-aware per-project subscription cap. Resolved from the api's internal
 * /v1/internal/projects/:id/limits endpoint on first subscribe per project,
 * cached for 5 min so tier changes propagate within one window. Returns
 * null when the project doesn't exist OR the api is unreachable — caller
 * falls back to the env ceiling so a metadata outage doesn't lock out
 * legitimate subscriptions.
 */
const TIER_CAP_CACHE_TTL_MS = 5 * 60_000;
interface CapCacheEntry {
  cap: number | null;
  expiresAt: number;
}
const capByProject = new Map<string, CapCacheEntry>();

async function resolveProjectCap(projectId: string): Promise<number | null> {
  const now = Date.now();
  const hit = capByProject.get(projectId);
  if (hit && hit.expiresAt > now) return hit.cap;
  if (!env.BRIVEN_RUNTIME_SHARED_SECRET) return null;
  try {
    const url = `${env.BRIVEN_API_INTERNAL_URL}/v1/internal/projects/${encodeURIComponent(
      projectId,
    )}/limits`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${env.BRIVEN_RUNTIME_SHARED_SECRET}` },
    });
    if (!res.ok) {
      capByProject.set(projectId, { cap: null, expiresAt: now + TIER_CAP_CACHE_TTL_MS });
      return null;
    }
    const body = (await res.json()) as {
      limits: { concurrentSubscriptions?: number } | null;
    };
    const cap = body.limits?.concurrentSubscriptions ?? null;
    capByProject.set(projectId, { cap, expiresAt: now + TIER_CAP_CACHE_TTL_MS });
    return cap;
  } catch (err) {
    log.warn('realtime_resolve_cap_failed', {
      projectId,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function dbNameFor(projectId: string): string {
  return `proj_${projectId.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
}

function channelFor(projectId: string, table: string): string {
  return `briven_${dbNameFor(projectId)}_${table}`;
}

// ── PollManager — Dolt commit-diff polling (Phase 2) ──────────────
// Replaces Postgres LISTEN/NOTIFY. Each project is polled for HEAD
// changes; when a change is detected every channel for that project
// fires via the existing `fireChannel` path.

const pollManager = new PollManager(registry, fireChannel, env.BRIVEN_REALTIME_POLL_MS);

// Per-project refcount — when the first channel is attached for a
// project we call pollManager.addProject; when the last is detached
// we call pollManager.removeProject. Keeps the poll set tight.
const projectRefCount = new Map<string, number>();

function projectIdFromChannel(channel: string): string | null {
  // channels are `briven_<dbName>_<table>` where dbName = `proj_<sanitizedId>`.
  // Strip the `briven_` prefix and the trailing `_<table>` suffix to recover
  // the database name, then strip `proj_` to recover the raw project id.
  const withoutPrefix = channel.slice('briven_'.length);
  const lastUnderscore = withoutPrefix.lastIndexOf('_');
  if (lastUnderscore === -1) return null;
  const dbName = withoutPrefix.slice(0, lastUnderscore);
  // dbName is `proj_<sanitized>`. The project id is everything after `proj_`.
  // Since project ids are sanitised (alphanumeric + underscores only), this is
  // a reversible mapping (the sanitised id is what's stored in the db name).
  return dbName.slice('proj_'.length);
}

async function startListen(channel: string): Promise<void> {
  const pid = projectIdFromChannel(channel);
  if (!pid) return;
  const prev = projectRefCount.get(pid) ?? 0;
  projectRefCount.set(pid, prev + 1);
  if (prev === 0) {
    // First channel for this project — start polling it.
    pollManager.addProject(pid);
    log.info('realtime_project_watch_started', { projectId: pid, channel });
  }
}

async function stopListen(channel: string): Promise<void> {
  const pid = projectIdFromChannel(channel);
  if (!pid) return;
  const prev = projectRefCount.get(pid) ?? 0;
  if (prev <= 1) {
    projectRefCount.delete(pid);
    pollManager.removeProject(pid);
    log.info('realtime_project_watch_stopped', { projectId: pid, channel });
  } else {
    projectRefCount.set(pid, prev - 1);
  }
}

async function fireChannel(channel: string): Promise<void> {
  // SubscriptionRegistry.subsForChannel returns a snapshot — safe to iterate
  // while attach/detach inside invokeOnce mutates the channel's live set.
  const snapshot = registry.subsForChannel(channel);
  if (snapshot.length === 0) return;
  incCounter('briven_realtime_notifies_total');
  for (const subId of snapshot) {
    const sub = subscriptions.get(subId);
    if (!sub) continue;
    const result = await invokeOnce(sub);
    incCounter('briven_realtime_reinvoke_total', {
      outcome: (result as { ok?: boolean }).ok ? 'ok' : 'err',
    });
    sub.send({ type: 'data', subscriptionId: sub.subscriptionId, ...result });
  }
}

async function invokeOnce(sub: Subscription): Promise<Record<string, unknown>> {
  // why: the public /v1/projects/:id/functions/:name route requires a
  // session or api-key with developer role. Realtime is a system caller,
  // not a user — it authenticates as the runtime via the shared secret
  // and uses the internal invoke endpoint, which threads `auth: null`.
  const url = `${env.BRIVEN_API_INTERNAL_URL}/v1/internal/projects/${sub.projectId}/functions/${sub.functionName}`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (env.BRIVEN_RUNTIME_SHARED_SECRET) {
    headers['authorization'] = `Bearer ${env.BRIVEN_RUNTIME_SHARED_SECRET}`;
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(sub.args ?? {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, code: 'invoke_failed', message: text || `http ${res.status}` };
    }
    const body = (await res.json()) as {
      ok: boolean;
      value?: unknown;
      code?: string;
      message?: string;
      durationMs?: number;
      touchedTables?: string[];
    };
    // Update channel subscriptions to match what the executor actually
    // touched. Adding new ones is idempotent; removing dropped ones keeps
    // the LISTEN set tight.
    const next = new Set((body.touchedTables ?? []).map((t) => channelFor(sub.projectId, t)));
    for (const ch of sub.channels) {
      if (!next.has(ch)) await detachSubFromChannel(sub.subscriptionId, ch);
    }
    for (const ch of next) {
      if (!sub.channels.has(ch)) await attachSubToChannel(sub.subscriptionId, ch);
    }
    sub.channels = next;
    return body as unknown as Record<string, unknown>;
  } catch (err) {
    return {
      ok: false,
      code: 'invoke_error',
      message: err instanceof Error ? err.message : 'unknown',
    };
  }
}

async function attachSubToChannel(subId: string, channel: string): Promise<void> {
  if (registry.attach(subId, channel)) await startListen(channel);
}

async function detachSubFromChannel(subId: string, channel: string): Promise<void> {
  if (registry.detach(subId, channel)) await stopListen(channel);
}

async function dropSubscription(subId: string): Promise<void> {
  const sub = subscriptions.get(subId);
  if (!sub) return;
  for (const ch of sub.channels) await detachSubFromChannel(subId, ch);
  // Flush this sub's connection seconds into the per-project tally so
  // the metric survives the sub teardown. (Math.max guards against
  // a clock skew producing a negative — postgres NTP is solid here
  // but the realtime container's clock isn't authoritative.)
  const seconds = Math.max(0, (Date.now() - sub.startedAt) / 1000);
  closedSubSecondsByProject.set(
    sub.projectId,
    (closedSubSecondsByProject.get(sub.projectId) ?? 0) + seconds,
  );
  // Decrement the per-project counter. Map entry deleted at 0 so the
  // map doesn't grow unbounded with dormant projects.
  const next = (subsByProject.get(sub.projectId) ?? 0) - 1;
  if (next <= 0) subsByProject.delete(sub.projectId);
  else subsByProject.set(sub.projectId, next);
  subscriptions.delete(subId);
}

/**
 * Authorise an incoming WS upgrade. Refuses ALL requests when the shared
 * secret is unset — prior behaviour returned `true` (fail-open), which
 * combined with deployments that forgot to set the env var produced an
 * unauthenticated WebSocket service. apps/api/src/routes/internal.ts
 * already does the right thing (503 when secret unset); this matches.
 */
function authorise(req: Request): boolean {
  if (!env.BRIVEN_RUNTIME_SHARED_SECRET) return false;
  const auth = req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
  if (!token) return false;
  return constantTimeEqual(token, env.BRIVEN_RUNTIME_SHARED_SECRET);
}

if (!env.BRIVEN_RUNTIME_SHARED_SECRET) {
  log.warn(
    'realtime_boot_warning: BRIVEN_RUNTIME_SHARED_SECRET is unset — every WS upgrade will be rejected with 401 until configured',
  );
}

// Pull-based gauges — snapshot at scrape time. Keeps the subscribe /
// unsubscribe hot paths free of gauge bookkeeping.
registerGauge('briven_realtime_subscriptions_active', () => [
  { labels: {}, value: subscriptions.size },
]);
registerGauge('briven_realtime_channels_active', () => [
  { labels: {}, value: registry.channelCount },
]);

// Per-project cumulative connection-seconds. The closed-sub tally is the
// authoritative base; we add (now - startedAt) for every still-live sub
// so a scrape during a long-running subscription doesn't show 0. Polar
// metering reads this via /metrics on the aggregation cron in apps/api.
registerGauge('briven_realtime_connection_seconds_total', () => {
  const out: { labels: { project: string }; value: number }[] = [];
  const now = Date.now();
  const liveByProject = new Map<string, number>();
  for (const sub of subscriptions.values()) {
    liveByProject.set(
      sub.projectId,
      (liveByProject.get(sub.projectId) ?? 0) + (now - sub.startedAt) / 1000,
    );
  }
  const projects = new Set<string>([
    ...closedSubSecondsByProject.keys(),
    ...liveByProject.keys(),
  ]);
  for (const projectId of projects) {
    const value =
      (closedSubSecondsByProject.get(projectId) ?? 0) + (liveByProject.get(projectId) ?? 0);
    out.push({ labels: { project: projectId }, value });
  }
  return out;
});

// Record the data-plane DSN so the first subscription doesn't block on
// setup. When BRIVEN_DATA_PLANE_URL is unset the init is a no-op;
// PollManager opens per-project clients lazily and handles the absent
// DSN gracefully (polling stays disabled).
if (env.BRIVEN_DATA_PLANE_URL) {
  pollManager.init(env.BRIVEN_DATA_PLANE_URL).catch((err) => {
    log.error('realtime_poll_manager_init_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  });
}

log.info('realtime_boot', {
  port: env.BRIVEN_REALTIME_PORT,
  apiUrl: env.BRIVEN_API_INTERNAL_URL,
  auth: env.BRIVEN_RUNTIME_SHARED_SECRET ? 'shared_secret' : 'rejecting_all',
  poll: env.BRIVEN_DATA_PLANE_URL ? 'enabled' : 'disabled',
  pollIntervalMs: env.BRIVEN_REALTIME_POLL_MS,
  phase: 2, // @README-BRIVEN Phase 2: commit-diff polling live
});

interface SocketHandle {
  send: (data: string) => void;
}

export default {
  port: env.BRIVEN_REALTIME_PORT,
  fetch(req: Request, server: { upgrade: (req: Request) => boolean }) {
    const url = new URL(req.url);
    if (url.pathname === '/health') return Response.json({ status: 'ok', service: 'realtime' });
    if (url.pathname === '/ready') {
      return Response.json({
        status: env.BRIVEN_DATA_PLANE_URL ? 'ready' : 'degraded',
        poll: env.BRIVEN_DATA_PLANE_URL ? 'enabled' : 'disabled',
        pollIntervalMs: env.BRIVEN_REALTIME_POLL_MS,
        activeProjects: pollManager.projectCount,
      });
    }
    if (url.pathname === '/info') {
      return Response.json({
        service: 'realtime',
        env: env.BRIVEN_ENV,
        buildSha: BUILD_SHA,
        buildAt: BUILD_AT,
        bootedAt: BOOT_TIME,
        uptimeSec: Math.floor(process.uptime()),
      });
    }
    if (url.pathname === '/metrics') {
      return new Response(renderPrometheus(), {
        status: 200,
        headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' },
      });
    }
    if (url.pathname === '/v1/realtime/stats') {
      // Operator-facing live snapshot. Shared-secret gated — same gate
      // as /v1/subscribe so an unauth scrape can't enumerate project
      // ids. Numbers are O(subscriptions.size), fine for the year-one
      // 10k target; if it ever needs to scale further the natural
      // aggregation is a periodic write to a stats endpoint on the api.
      if (!authorise(req)) return Response.json({ code: 'unauthorized' }, { status: 401 });
      const byProject: { projectId: string; subscriptions: number }[] = [];
      for (const [projectId, count] of subsByProject) {
        byProject.push({ projectId, subscriptions: count });
      }
      byProject.sort((a, b) => b.subscriptions - a.subscriptions);
      const byChannel = registry.channelCounts();
      byChannel.sort((a, b) => b.subscriptions - a.subscriptions);
      return Response.json({
        totalSubscriptions: subscriptions.size,
        totalChannels: registry.channelCount,
        limits: {
          perWs: env.BRIVEN_REALTIME_MAX_SUBS_PER_WS,
          perProject: env.BRIVEN_REALTIME_MAX_SUBS_PER_PROJECT,
        },
        // byProject returns every active project — at year-one scale
        // (~25 projects) the response stays under a kilobyte; we rely on
        // sort-descending so dashboards can render top-N client-side.
        // byChannel keeps its top-50 clamp since channel cardinality can
        // explode with many tables × many subscribers.
        byProject,
        byChannel: byChannel.slice(0, 50),
      });
    }
    if (url.pathname === '/v1/subscribe') {
      if (!authorise(req)) return Response.json({ code: 'unauthorized' }, { status: 401 });
      if (server.upgrade(req)) return undefined;
      return new Response('upgrade required', { status: 426 });
    }
    return Response.json({ code: 'not_found' }, { status: 404 });
  },
  websocket: {
    open(ws: SocketHandle) {
      sockets.set(ws as unknown as object, new Set<string>());
      ws.send(JSON.stringify({ type: 'hello', protocol: 1 }));
    },
    async message(ws: SocketHandle, raw: string | Buffer) {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      let parsed: z.infer<typeof clientMessage>;
      try {
        parsed = clientMessage.parse(JSON.parse(text));
      } catch {
        ws.send(JSON.stringify({ type: 'error', code: 'malformed_message' }));
        return;
      }

      const owned = sockets.get(ws as unknown as object);
      if (!owned) return;

      if (parsed.type === 'unsubscribe') {
        owned.delete(parsed.subscriptionId);
        await dropSubscription(parsed.subscriptionId);
        ws.send(JSON.stringify({ type: 'unsubscribed', subscriptionId: parsed.subscriptionId }));
        return;
      }

      if (owned.size >= env.BRIVEN_REALTIME_MAX_SUBS_PER_WS) {
        // Defensive cap so a single client (bug or malicious) can't open
        // unbounded subscriptions and degrade the service for everyone.
        // The client sees an error frame referencing the offending sub
        // id so it can correlate; the server-side counter has already
        // ignored this sub, so unsubscribe isn't required.
        incCounter('briven_realtime_subscribe_rejected_total', { reason: 'ws_limit' });
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'subscription_limit_ws',
            subscriptionId: parsed.subscriptionId,
            limit: env.BRIVEN_REALTIME_MAX_SUBS_PER_WS,
          }),
        );
        return;
      }
      const projectCount = subsByProject.get(parsed.projectId) ?? 0;
      // Tier-aware cap when the api answers; env ceiling as the floor so
      // a metadata outage doesn't lock out legitimate Team customers.
      const tierCap = await resolveProjectCap(parsed.projectId);
      const projectLimit = tierCap ?? env.BRIVEN_REALTIME_MAX_SUBS_PER_PROJECT;
      if (projectCount >= projectLimit) {
        incCounter('briven_realtime_subscribe_rejected_total', { reason: 'project_limit' });
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'subscription_limit_project',
            subscriptionId: parsed.subscriptionId,
            limit: projectLimit,
            source: tierCap !== null ? 'tier' : 'env',
          }),
        );
        return;
      }

      const sub: Subscription = {
        subscriptionId: parsed.subscriptionId,
        projectId: parsed.projectId,
        functionName: parsed.functionName,
        args: parsed.args,
        channels: new Set<string>(),
        send: (frame) => ws.send(JSON.stringify(frame)),
        startedAt: Date.now(),
      };
      subscriptions.set(sub.subscriptionId, sub);
      owned.add(sub.subscriptionId);
      subsByProject.set(sub.projectId, projectCount + 1);
      const result = await invokeOnce(sub);
      ws.send(JSON.stringify({ type: 'data', subscriptionId: sub.subscriptionId, ...result }));
    },
    async close(ws: object) {
      const owned = sockets.get(ws);
      if (!owned) return;
      for (const subId of owned) await dropSubscription(subId);
      sockets.delete(ws);
    },
  },
};

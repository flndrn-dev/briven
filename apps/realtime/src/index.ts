import postgres from 'postgres';
import { z } from 'zod';

import { env } from './env.js';

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
 *   2. Response includes `touchedTables`; realtime LISTENs on
 *      `briven_<projectSchema>_<table>` for each (one LISTEN per channel
 *      shared across subscriptions, refcounted)
 *   3. Postgres NOTIFY → realtime re-invokes every subscription that
 *      touched that table, sends a fresh `data` frame
 *   4. Unsubscribe / disconnect → drop the subscription, decrement channel
 *      refcounts, UNLISTEN when no subscriber remains
 *
 * Note: postgres LISTEN is connection-scoped. We hold a single dedicated
 * connection (no pooling) for the whole realtime instance and serialise
 * LISTEN/UNLISTEN through it.
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
}

const subscriptions = new Map<string, Subscription>(); // subscriptionId → sub
const channelToSubs = new Map<string, Set<string>>(); // channel → set of subscriptionIds
const sockets = new WeakMap<object, Set<string>>(); // ws → set of subscriptionIds it owns

function schemaNameFor(projectId: string): string {
  return `proj_${projectId.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
}

function channelFor(projectId: string, table: string): string {
  return `briven_${schemaNameFor(projectId)}_${table}`;
}

let listener: postgres.Sql | null = null;

async function getListener(): Promise<postgres.Sql | null> {
  if (!env.BRIVEN_DATA_PLANE_URL) return null;
  if (listener) return listener;
  listener = postgres(env.BRIVEN_DATA_PLANE_URL, {
    max: 1,
    idle_timeout: 0,
    connect_timeout: 5,
    prepare: false,
  });
  return listener;
}

async function ensureListen(channel: string): Promise<void> {
  const subs = channelToSubs.get(channel);
  if (subs && subs.size > 0) return; // already listening
  const sql = await getListener();
  if (!sql) return;
  await sql.listen(channel, () => fireChannel(channel));
}

async function ensureUnlisten(channel: string): Promise<void> {
  const subs = channelToSubs.get(channel);
  if (subs && subs.size > 0) return; // still has subscribers
  channelToSubs.delete(channel);
  const sql = await getListener();
  if (!sql) return;
  await sql.unsafe(`UNLISTEN "${channel}"`).catch(() => undefined);
}

async function fireChannel(channel: string): Promise<void> {
  const subIds = channelToSubs.get(channel);
  if (!subIds) return;
  for (const subId of subIds) {
    const sub = subscriptions.get(subId);
    if (!sub) continue;
    const result = await invokeOnce(sub);
    sub.send({ type: 'data', subscriptionId: sub.subscriptionId, ...result });
  }
}

async function invokeOnce(sub: Subscription): Promise<Record<string, unknown>> {
  const url = `${env.BRIVEN_API_INTERNAL_URL}/v1/projects/${sub.projectId}/functions/${sub.functionName}`;
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
  let subs = channelToSubs.get(channel);
  if (!subs) {
    subs = new Set();
    channelToSubs.set(channel, subs);
  }
  subs.add(subId);
  await ensureListen(channel);
}

async function detachSubFromChannel(subId: string, channel: string): Promise<void> {
  const subs = channelToSubs.get(channel);
  if (!subs) return;
  subs.delete(subId);
  if (subs.size === 0) await ensureUnlisten(channel);
}

async function dropSubscription(subId: string): Promise<void> {
  const sub = subscriptions.get(subId);
  if (!sub) return;
  for (const ch of sub.channels) await detachSubFromChannel(subId, ch);
  subscriptions.delete(subId);
}

function authorise(req: Request): boolean {
  if (!env.BRIVEN_RUNTIME_SHARED_SECRET) return true;
  const auth = req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
  return token === env.BRIVEN_RUNTIME_SHARED_SECRET;
}

console.log(
  JSON.stringify({
    event: 'realtime_boot',
    port: env.BRIVEN_REALTIME_PORT,
    apiUrl: env.BRIVEN_API_INTERNAL_URL,
    auth: env.BRIVEN_RUNTIME_SHARED_SECRET ? 'shared_secret' : 'open',
    listen: env.BRIVEN_DATA_PLANE_URL ? 'enabled' : 'disabled',
  }),
);

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
        listen: env.BRIVEN_DATA_PLANE_URL ? 'enabled' : 'disabled',
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

      const sub: Subscription = {
        subscriptionId: parsed.subscriptionId,
        projectId: parsed.projectId,
        functionName: parsed.functionName,
        args: parsed.args,
        channels: new Set<string>(),
        send: (frame) => ws.send(JSON.stringify(frame)),
      };
      subscriptions.set(sub.subscriptionId, sub);
      owned.add(sub.subscriptionId);
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

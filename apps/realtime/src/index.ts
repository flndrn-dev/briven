import { z } from 'zod';

import { env } from './env.js';

/**
 * Phase 1 realtime service.
 *
 * Scope today: a WebSocket endpoint at `/v1/subscribe` that, on each
 * `subscribe` message, calls the api once and pushes the result back as a
 * single `data` event. There is **no** push on data change yet — that
 * arrives in Phase 2 once the schema-apply worker emits LISTEN/NOTIFY
 * triggers per CLAUDE.md §7.4 step 6-7.
 *
 * Auth: same shared secret the runtime uses. End-user JWT validation
 * lands when the dashboard issues SDK tokens (Phase 2 also).
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
type ClientMessage = z.infer<typeof clientMessage>;

interface Subscription {
  subscriptionId: string;
  projectId: string;
  functionName: string;
  args: unknown;
}

const sockets = new WeakMap<object, Map<string, Subscription>>();

function authorise(req: Request): boolean {
  if (!env.BRIVEN_RUNTIME_SHARED_SECRET) return true;
  const auth = req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
  return token === env.BRIVEN_RUNTIME_SHARED_SECRET;
}

async function invokeOnce(sub: Subscription): Promise<{
  ok: boolean;
  value?: unknown;
  code?: string;
  message?: string;
}> {
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
    const body = (await res.json()) as { ok: boolean; value?: unknown; code?: string; message?: string };
    return body;
  } catch (err) {
    return { ok: false, code: 'invoke_error', message: err instanceof Error ? err.message : 'unknown' };
  }
}

console.log(
  JSON.stringify({
    event: 'realtime_boot',
    port: env.BRIVEN_REALTIME_PORT,
    apiUrl: env.BRIVEN_API_INTERNAL_URL,
    auth: env.BRIVEN_RUNTIME_SHARED_SECRET ? 'shared_secret' : 'open',
  }),
);

export default {
  port: env.BRIVEN_REALTIME_PORT,
  fetch(req: Request, server: { upgrade: (req: Request) => boolean }) {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'realtime' });
    }
    if (url.pathname === '/v1/subscribe') {
      if (!authorise(req)) {
        return Response.json({ code: 'unauthorized' }, { status: 401 });
      }
      if (server.upgrade(req)) return undefined;
      return new Response('upgrade required', { status: 426 });
    }
    return Response.json({ code: 'not_found' }, { status: 404 });
  },
  websocket: {
    open(ws: { send: (data: string) => void }) {
      sockets.set(ws, new Map<string, Subscription>());
      ws.send(JSON.stringify({ type: 'hello', protocol: 1 }));
    },
    async message(ws: { send: (data: string) => void }, raw: string | Buffer) {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      let parsed: ClientMessage;
      try {
        parsed = clientMessage.parse(JSON.parse(text));
      } catch {
        ws.send(JSON.stringify({ type: 'error', code: 'malformed_message' }));
        return;
      }

      const subs = sockets.get(ws);
      if (!subs) return;

      if (parsed.type === 'unsubscribe') {
        subs.delete(parsed.subscriptionId);
        ws.send(JSON.stringify({ type: 'unsubscribed', subscriptionId: parsed.subscriptionId }));
        return;
      }

      // subscribe: store + invoke once. Phase 2 wires LISTEN/NOTIFY to push
      // additional `data` frames whenever any table the function touched
      // changes.
      subs.set(parsed.subscriptionId, parsed);
      const result = await invokeOnce(parsed);
      ws.send(
        JSON.stringify({
          type: 'data',
          subscriptionId: parsed.subscriptionId,
          ...result,
        }),
      );
    },
    close(ws: object) {
      sockets.delete(ws);
    },
  },
};

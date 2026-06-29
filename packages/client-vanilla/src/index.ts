/**
 * @briven/client — framework-agnostic browser client for briven projects.
 *
 *   const briven = createBrivenClient({
 *     projectId: 'p_...',
 *     apiOrigin: 'https://api.briven.tech',
 *     wsOrigin: 'wss://ws.briven.tech',
 *   });
 *
 *   const notes = await briven.invoke('listNotes');
 *
 *   const sub = briven.subscribe('listNotes', { userId: 'u_...' }, (frame) => {
 *     console.log(frame.value);
 *   });
 *   // sub.close() when done
 */

export interface BrivenClientOptions {
  /** Briven project id (`p_...`). Required. */
  readonly projectId: string;
  /** REST control plane origin, e.g. `https://api.briven.tech`. */
  readonly apiOrigin: string;
  /** WebSocket origin for reactive queries, e.g. `wss://ws.briven.tech`. */
  readonly wsOrigin?: string;
  /** Session token / api key forwarded as `Authorization: Bearer <token>`. */
  readonly token?: string | (() => string | Promise<string>);
  /** Auto-reconnect after a transient disconnect. Default: true. */
  readonly reconnect?: boolean;
}

export type InvokeFrame =
  | { ok: true; value: unknown; durationMs: number; deploymentId?: string }
  | { ok: false; code: string; message: string; durationMs: number };

export interface SubscribeHandle {
  readonly subscriptionId: string;
  /** Unsubscribe and stop receiving frames. Idempotent. */
  close(): void;
}

export interface BrivenClient {
  /** One-shot invoke over HTTP. */
  invoke(functionName: string, args?: unknown): Promise<InvokeFrame>;
  /** Subscribe to a function. The handler is called once on initial value
   *  and again every time the touched tables change. */
  subscribe(
    functionName: string,
    args: unknown,
    handler: (frame: InvokeFrame) => void,
  ): SubscribeHandle;
  /** Force-close all subscriptions and the underlying socket. */
  close(): void;
}

interface ActiveSubscription {
  subscriptionId: string;
  functionName: string;
  args: unknown;
  handler: (frame: InvokeFrame) => void;
}

export function createBrivenClient(options: BrivenClientOptions): BrivenClient {
  const reconnect = options.reconnect !== false;
  let ws: WebSocket | null = null;
  let connecting: Promise<WebSocket> | null = null;
  let backoffMs = 500;
  let closed = false;
  const active = new Map<string, ActiveSubscription>();
  // Subscription ids already sent on the CURRENT socket. Reset on every
  // (re)connect. Guards against the same subscribe frame going out twice
  // when subscribe() races the reconnect loop's bulk re-send.
  let sentOnSocket = new Set<string>();

  async function resolveToken(): Promise<string | null> {
    if (!options.token) return null;
    return typeof options.token === 'function' ? options.token() : options.token;
  }

  async function ensureSocket(): Promise<WebSocket> {
    if (closed) throw new Error('client closed');
    if (ws && ws.readyState === WebSocket.OPEN) return ws;
    if (connecting) return connecting;

    if (!options.wsOrigin) {
      throw new Error('wsOrigin not configured — subscribe() requires it');
    }

    connecting = (async () => {
      const token = await resolveToken();
      const url = new URL('/v1/subscribe', options.wsOrigin!).toString();
      const sock = new WebSocket(url + (token ? `?token=${encodeURIComponent(token)}` : ''));
      // Register lifecycle listeners BEFORE the open/error race. If 'close'
      // were only attached after a successful open, a server that is down
      // at the very first connect would reject here and the reconnect chain
      // would die permanently (subscriptions silently dead until reload).
      // Attaching 'close' up front means onClose() fires on a failed first
      // connect too, so reconnect keeps retrying with backoff.
      sock.addEventListener('message', (e) => onMessage(e.data));
      sock.addEventListener('close', () => onClose());
      await new Promise<void>((resolve, reject) => {
        sock.addEventListener('open', () => resolve(), { once: true });
        sock.addEventListener('error', () => reject(new Error('ws_open_failed')), { once: true });
      });
      ws = sock;
      backoffMs = 500;
      // Re-send all active subscriptions on (re)connect. Reset the
      // per-socket sent-set first so this fresh socket re-sends each.
      sentOnSocket = new Set<string>();
      for (const sub of active.values()) sendSubscribe(sock, sub);
      return sock;
    })();

    try {
      return await connecting;
    } finally {
      connecting = null;
    }
  }

  function onClose() {
    ws = null;
    if (closed || !reconnect || active.size === 0) return;
    // Add ±25% jitter so a fleet of clients that all dropped at once don't
    // reconnect in lockstep and thundering-herd the server.
    const delay = Math.min(backoffMs, 30_000) * (0.75 + Math.random() * 0.5);
    backoffMs = Math.min(backoffMs * 2, 30_000);
    setTimeout(() => {
      void ensureSocket().catch(() => undefined);
    }, delay);
  }

  function onMessage(raw: string | ArrayBuffer | Blob): void {
    if (typeof raw !== 'string') return;
    let frame: { type: string; subscriptionId?: string } & Record<string, unknown>;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (frame.type !== 'data' || !frame.subscriptionId) return;
    const sub = active.get(frame.subscriptionId);
    if (!sub) return;
    sub.handler(frame as unknown as InvokeFrame);
  }

  function sendSubscribe(sock: WebSocket, sub: ActiveSubscription): void {
    // Exactly-once per socket: the reconnect loop bulk-re-sends every
    // active sub on a fresh socket, and subscribe()'s own .then() also
    // calls here — without this guard a sub freshly added during a connect
    // would be sent twice (drifting the server's subsByProject counter).
    if (sentOnSocket.has(sub.subscriptionId)) return;
    sentOnSocket.add(sub.subscriptionId);
    sock.send(
      JSON.stringify({
        type: 'subscribe',
        subscriptionId: sub.subscriptionId,
        projectId: options.projectId,
        functionName: sub.functionName,
        args: sub.args,
      }),
    );
  }

  async function invoke(functionName: string, args: unknown = {}): Promise<InvokeFrame> {
    // invoke() must NEVER throw: the framework wrappers (react/vue/svelte
    // mutate()) await it with no try/catch, so a thrown SyntaxError (from a
    // non-JSON 502/504 gateway body) or a network failure would leave the
    // component stuck `isPending: true` forever with no visible error.
    try {
      const token = await resolveToken();
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (token) headers['authorization'] = `Bearer ${token}`;
      const url = `${options.apiOrigin}/v1/projects/${options.projectId}/functions/${functionName}`;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(args ?? {}),
        credentials: token ? 'omit' : 'include',
      });
      // Read as text first, then parse. The api returns a JSON error frame
      // even for function errors (e.g. 422), so a valid JSON body — ok or
      // not — is returned as-is. Only a body that isn't JSON at all (HTML
      // gateway error page) becomes a synthetic network_error frame.
      const body = await res.text();
      try {
        return JSON.parse(body) as InvokeFrame;
      } catch {
        return {
          ok: false,
          code: 'network_error',
          message: res.ok
            ? 'invalid (non-JSON) response from server'
            : `request failed (${res.status})`,
          durationMs: 0,
        };
      }
    } catch (err) {
      return {
        ok: false,
        code: 'network_error',
        message: err instanceof Error ? err.message : 'network error',
        durationMs: 0,
      };
    }
  }

  function subscribe(
    functionName: string,
    args: unknown,
    handler: (frame: InvokeFrame) => void,
  ): SubscribeHandle {
    const subscriptionId = crypto.randomUUID();
    const sub: ActiveSubscription = { subscriptionId, functionName, args, handler };
    active.set(subscriptionId, sub);

    void ensureSocket()
      .then((sock) => sendSubscribe(sock, sub))
      .catch((err) => {
        handler({
          ok: false,
          code: 'connect_failed',
          message: err instanceof Error ? err.message : 'unknown',
          durationMs: 0,
        });
      });

    return {
      subscriptionId,
      close: () => {
        active.delete(subscriptionId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'unsubscribe', subscriptionId }));
        }
      },
    };
  }

  function close(): void {
    closed = true;
    active.clear();
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  return { invoke, subscribe, close };
}

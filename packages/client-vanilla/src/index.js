/**
 * @briven/client — framework-agnostic browser client for briven projects.
 *
 *   const briven = createBrivenClient({
 *     projectId: 'p_...',
 *     apiOrigin: 'https://api.briven.cloud',
 *     wsOrigin: 'wss://ws.briven.cloud',
 *   });
 *
 *   const notes = await briven.invoke('listNotes');
 *
 *   const sub = briven.subscribe('listNotes', { userId: 'u_...' }, (frame) => {
 *     console.log(frame.value);
 *   });
 *   // sub.close() when done
 */
export function createBrivenClient(options) {
  const reconnect = options.reconnect !== false;
  let ws = null;
  let connecting = null;
  let backoffMs = 500;
  let closed = false;
  const active = new Map();
  async function resolveToken() {
    if (!options.token) return null;
    return typeof options.token === 'function' ? options.token() : options.token;
  }
  async function ensureSocket() {
    if (closed) throw new Error('client closed');
    if (ws && ws.readyState === WebSocket.OPEN) return ws;
    if (connecting) return connecting;
    if (!options.wsOrigin) {
      throw new Error('wsOrigin not configured — subscribe() requires it');
    }
    connecting = (async () => {
      const token = await resolveToken();
      const url = new URL('/v1/subscribe', options.wsOrigin).toString();
      const sock = new WebSocket(url + (token ? `?token=${encodeURIComponent(token)}` : ''));
      await new Promise((resolve, reject) => {
        sock.addEventListener('open', () => resolve(), { once: true });
        sock.addEventListener('error', () => reject(new Error('ws_open_failed')), { once: true });
      });
      sock.addEventListener('message', (e) => onMessage(e.data));
      sock.addEventListener('close', () => onClose());
      ws = sock;
      backoffMs = 500;
      // Re-send all active subscriptions on (re)connect.
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
    const delay = Math.min(backoffMs, 30_000);
    backoffMs = Math.min(backoffMs * 2, 30_000);
    setTimeout(() => {
      void ensureSocket().catch(() => undefined);
    }, delay);
  }
  function onMessage(raw) {
    if (typeof raw !== 'string') return;
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (frame.type !== 'data' || !frame.subscriptionId) return;
    const sub = active.get(frame.subscriptionId);
    if (!sub) return;
    sub.handler(frame);
  }
  function sendSubscribe(sock, sub) {
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
  async function invoke(functionName, args = {}) {
    const token = await resolveToken();
    const headers = { 'content-type': 'application/json' };
    if (token) headers['authorization'] = `Bearer ${token}`;
    const url = `${options.apiOrigin}/v1/projects/${options.projectId}/functions/${functionName}`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(args ?? {}),
      credentials: token ? 'omit' : 'include',
    });
    return await res.json();
  }
  function subscribe(functionName, args, handler) {
    const subscriptionId = crypto.randomUUID();
    const sub = { subscriptionId, functionName, args, handler };
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
  function close() {
    closed = true;
    active.clear();
    if (ws) {
      ws.close();
      ws = null;
    }
  }
  return { invoke, subscribe, close };
}
//# sourceMappingURL=index.js.map

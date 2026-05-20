import { randomBytes, randomInt } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { hostname } from 'node:os';

import { writeUserCredential } from './config.js';

interface ResultOk {
  ok: true;
  token: string;
}
interface ResultErr {
  ok: false;
  reason: string;
}
export type CallbackResult = ResultOk | ResultErr;

export function generateState(): string {
  return randomBytes(32).toString('hex');
}

export function isLoopback(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:') return false;
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  } catch {
    return false;
  }
}

export function handleCallback(req: Request, expectedState: string): CallbackResult {
  const url = new URL(req.url);
  const state = url.searchParams.get('state') ?? '';
  if (state !== expectedState) return { ok: false, reason: 'state mismatch' };
  if (url.searchParams.get('denied') === '1') return { ok: false, reason: 'user denied' };
  const token = url.searchParams.get('token');
  if (!token) return { ok: false, reason: 'no token in callback' };
  return { ok: true, token };
}

export interface OAuthOptions {
  apiOrigin: string;
  dashboardOrigin: string;
  /** Override for tests — when set, do NOT actually open a browser. */
  openBrowser?: (url: string) => Promise<void>;
  /** ms before throwing — defaults to 180s. */
  timeoutMs?: number;
}

export interface OAuthSuccess {
  token: string;
  apiOrigin: string;
}

/**
 * Runs the full OAuth handshake. Resolves with the captured token on
 * success; throws on timeout / denial. Persists nothing on its own —
 * caller decides whether to writeUserCredential().
 */
export async function runOAuth(opts: OAuthOptions): Promise<OAuthSuccess> {
  const state = generateState();
  const port = await bindFreePort();
  const dashUrl = new URL('/cli-auth', opts.dashboardOrigin);
  dashUrl.searchParams.set('redirect', `http://127.0.0.1:${port}/cb`);
  dashUrl.searchParams.set('state', state);
  dashUrl.searchParams.set('host', hostname());

  const opener = opts.openBrowser ?? defaultOpen;
  const captured: { token?: string; error?: string } = {};
  const server = await startServer(port, (req) => {
    const result = handleCallback(req, state);
    if (result.ok) {
      captured.token = result.token;
      return htmlResponse(200, 'Authorized. You can close this tab.');
    }
    captured.error = result.reason;
    return htmlResponse(400, `Authorization failed: ${result.reason}.`);
  });

  try {
    await opener(dashUrl.toString());
  } catch {
    // best-effort; user can still copy URL from stdout
  }
  process.stdout.write(`\nOpened ${dashUrl.toString()}\nWaiting for authorization…\n`);

  const timeoutMs = opts.timeoutMs ?? 180_000;
  const deadline = Date.now() + timeoutMs;
  while (!captured.token && !captured.error && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
  server.close();
  if (captured.token) return { token: captured.token, apiOrigin: opts.apiOrigin };
  if (captured.error) throw new Error(`oauth: ${captured.error}`);
  throw new Error('oauth: timed out waiting for callback');
}

function htmlResponse(status: number, msg: string): Response {
  const body = `<!doctype html><meta charset=utf-8><title>briven cli</title><body style="font:14px/1.4 system-ui;padding:2em">${msg}</body>`;
  return new Response(body, { status, headers: { 'content-type': 'text/html' } });
}

async function bindFreePort(): Promise<number> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const port = randomInt(20000, 60000);
    if (await isPortFree(port)) return port;
  }
  throw new Error('oauth: could not find a free localhost port after 5 attempts');
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

function startServer(port: number, handler: (req: Request) => Response): Promise<Server> {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      const url = `http://127.0.0.1:${port}${req.url ?? '/'}`;
      const r = handler(new Request(url, { method: req.method ?? 'GET' }));
      res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
      res.end(await r.text());
    });
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

async function defaultOpen(url: string): Promise<void> {
  const open = (await import('open')).default;
  await open(url);
}

/** Re-export so callers can persist the token after wizard logic. */
export { writeUserCredential };

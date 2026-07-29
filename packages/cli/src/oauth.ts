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
      return htmlResponse(200, {
        title: 'CLI authorized',
        heading: "you're in",
        body: 'The briven CLI on this computer is authorized. Return to the terminal — you can close this tab.',
        ok: true,
      });
    }
    captured.error = result.reason;
    return htmlResponse(400, {
      title: 'CLI authorization failed',
      heading: 'not authorized',
      body: `Authorization failed: ${result.reason}. Close this tab and run the CLI again.`,
      ok: false,
    });
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

/** Dark Briven-styled local callback page (localhost after Allow). */
function htmlResponse(
  status: number,
  content: { title: string; heading: string; body: string; ok: boolean },
): Response {
  const accent = content.ok ? '#FFFD74' : '#f87171';
  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>${escapeHtml(content.title)} · briven</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100dvh; display: flex; align-items: center; justify-content: center;
      font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: #0a0b0d; color: #e8e8ea; padding: 1.5rem;
    }
    .card {
      width: 100%; max-width: 26rem; border: 1px solid #2a2c32; border-radius: 10px;
      background: #12141a; padding: 1.5rem;
    }
    .brand { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.25rem;
      color: #9a9ca3; font-size: 12px; letter-spacing: 0.04em; text-transform: lowercase; }
    .dot { width: 8px; height: 8px; border-radius: 999px; background: ${accent}; }
    h1 { margin: 0 0 0.5rem; font-size: 1.15rem; font-weight: 500; color: #f4f4f5; }
    p { margin: 0 0 1.25rem; color: #9a9ca3; font-size: 13px; }
    button {
      width: 100%; border: 0; border-radius: 8px; padding: 0.7rem 1rem; cursor: pointer;
      font: inherit; font-size: 13px; background: ${accent}; color: #111;
    }
    button:hover { filter: brightness(1.05); }
    button:disabled { opacity: 0.7; cursor: default; }
    .hint { margin-top: 0.85rem; font-size: 11px; color: #6b6e76; text-align: center; }
    kbd {
      display: inline-block; padding: 0.1em 0.4em; border: 1px solid #3a3d45; border-radius: 4px;
      background: #1a1c22; font: inherit; font-size: 11px; color: #e8e8ea;
    }
  </style>
</head>
<body>
  <main class="card" id="card">
    <div class="brand"><span class="dot" aria-hidden="true"></span>briven · cli</div>
    <h1 id="heading">${escapeHtml(content.heading)}</h1>
    <p id="body">${escapeHtml(content.body)}</p>
    <button type="button" id="close-btn">done — close this tab</button>
    <p class="hint" id="hint">
      tip: browsers often block auto-close. use the tab × or
      <kbd>⌘W</kbd> / <kbd>Ctrl+W</kbd> — the terminal already finished.
    </p>
  </main>
  <script>
    (function () {
      var btn = document.getElementById('close-btn');
      var heading = document.getElementById('heading');
      var body = document.getElementById('body');
      var hint = document.getElementById('hint');
      if (!btn) return;

      function showManualCloseHelp() {
        if (heading) heading.textContent = "you're done";
        if (body) {
          body.innerHTML =
            'Login already succeeded in the terminal. ' +
            'This tab cannot close itself (browser rule). ' +
            'Press <kbd>⌘W</kbd> (Mac) or <kbd>Ctrl+W</kbd> (Windows/Linux), or click the tab ×.';
        }
        btn.textContent = 'ok — use ⌘W / Ctrl+W to close';
        btn.disabled = true;
        if (hint) hint.textContent = 'safe to ignore this page — briven is already connected';
      }

      function tryClose() {
        // Tabs opened by redirect (not window.open) are usually not closable by script.
        // That is a browser security rule — not a Briven bug.
        try { window.close(); } catch (e) {}
        try {
          window.open('', '_self');
          window.close();
        } catch (e2) {}
      }

      btn.addEventListener('click', function () {
        tryClose();
        // If we're still here, the browser blocked close — explain clearly.
        setTimeout(function () {
          if (!window.closed) showManualCloseHelp();
        }, 150);
      });
    })();
  </script>
</body>
</html>`;
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

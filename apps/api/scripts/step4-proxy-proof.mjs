/**
 * Step 4 proof: first-party proxy keeps cookies on the **app** host.
 *
 * Spins up:
 *   - "API" Hono with real Doltgres briven-engine FDI
 *   - "App" Hono with /api/auth/* proxy → API FDI
 * Client hits App only; expects Set-Cookie + successful signup.
 *
 *   cd apps/api
 *   BRIVEN_ENGINE_DATABASE_URL=postgres://postgres:devpass@127.0.0.1:5434/briven_engine?sslmode=disable \
 *   BRIVEN_DATA_PLANE_URL=postgres://postgres:devpass@127.0.0.1:5434/postgres?sslmode=disable \
 *   bun scripts/step4-proxy-proof.mjs
 */

process.env.BRIVEN_AUTH_CORE_ENABLED = 'true';
process.env.BRIVEN_ENV = 'development';
process.env.BRIVEN_ENGINE_DATABASE_URL =
  process.env.BRIVEN_ENGINE_DATABASE_URL ??
  'postgres://postgres:devpass@127.0.0.1:5434/briven_engine?sslmode=disable';
process.env.BRIVEN_DATA_PLANE_URL =
  process.env.BRIVEN_DATA_PLANE_URL ??
  'postgres://postgres:devpass@127.0.0.1:5434/postgres?sslmode=disable';
process.env.BRIVEN_API_ORIGIN = 'http://127.0.0.1:3011';
process.env.BRIVEN_WEB_ORIGIN = 'http://127.0.0.1:3010';

import { Hono } from 'hono';

const { ensureBrivenEngineDatabase } = await import(
  '../src/services/auth-core/ensure-db.ts'
);
const { initAuthCoreSdk } = await import('../src/services/auth-core/engine.ts');
const { authCoreFdiRouter } = await import('../src/routes/auth-core-fdi.ts');
const { proxyBrivenEngineAuth, appAuthPathToFdiSuffix } = await import(
  '../../../packages/auth/src/engine/proxy.ts'
);

console.log('=== Step 4: first-party proxy (cookies on app host) ===');

if (!(await ensureBrivenEngineDatabase()).ok) {
  console.error('FAIL ensure DB');
  process.exit(1);
}
if (!(await initAuthCoreSdk())) {
  console.error('FAIL init');
  process.exit(1);
}

// Unit-ish path mapping
const mapped = appAuthPathToFdiSuffix('/api/auth/signup');
console.log('path map /api/auth/signup →', mapped);
if (mapped !== '/signup') {
  console.error('FAIL path map');
  process.exit(1);
}

// API server (briven-engine FDI)
const api = new Hono();
api.route('/', authCoreFdiRouter);
const apiServer = Bun.serve({
  port: 3011,
  fetch: api.fetch,
});
console.log('API on', apiServer.url.href);

// App server (first-party proxy)
const app = new Hono();
app.all('/api/auth/*', async (c) => {
  const res = await proxyBrivenEngineAuth(c.req.raw, {
    apiOrigin: 'http://127.0.0.1:3011',
    projectId: 'p_step4_local',
    proxyMount: '/api/auth',
  });
  return res;
});
app.get('/health', (c) => c.json({ app: true }));
const appServer = Bun.serve({
  port: 3010,
  fetch: app.fetch,
});
console.log('APP on', appServer.url.href);

const email = `step4_${Date.now()}@example.com`;
const password = 'Step4Test!Pass99';

// Client talks ONLY to app host
const res = await fetch('http://127.0.0.1:3010/api/auth/signup', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-briven-project-id': 'p_step4_local',
  },
  body: JSON.stringify({
    formFields: [
      { id: 'email', value: email },
      { id: 'password', value: password },
    ],
  }),
});

const body = await res.json().catch(() => ({}));
const setCookies =
  typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);

console.log('proxy signup status', res.status);
console.log('proxy body status', body.status);
console.log('x-briven-proxy', res.headers.get('x-briven-proxy'));
console.log('set-cookie count', setCookies.length);
console.log(
  'set-cookie sample',
  setCookies.map((c) => String(c).slice(0, 40) + '…'),
);

const ok =
  res.status === 200 &&
  body.status === 'OK' &&
  res.headers.get('x-briven-proxy') === 'first-party' &&
  setCookies.length >= 1 &&
  setCookies.some((c) => String(c).includes('sAccessToken'));

// Sign-in through proxy too
const res2 = await fetch('http://127.0.0.1:3010/api/auth/signin', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-briven-project-id': 'p_step4_local',
  },
  body: JSON.stringify({
    formFields: [
      { id: 'email', value: email },
      { id: 'password', value: password },
    ],
  }),
});
const body2 = await res2.json().catch(() => ({}));
console.log('proxy signin status', res2.status, body2.status);

apiServer.stop();
appServer.stop();

if (!ok || body2.status !== 'OK') {
  console.error('FAIL step 4', { ok, body, body2 });
  process.exit(1);
}

console.log('');
console.log('✔ STEP 4 PROOF OK');
console.log('  client hit: http://127.0.0.1:3010/api/auth/* (app host)');
console.log('  upstream:   http://127.0.0.1:3011/v1/auth-core/fdi/* (API)');
console.log('  Set-Cookie returned on app response: yes');
console.log('  signup + signin via proxy: OK');
console.log('  storage still Doltgres (via API)');
process.exit(0);

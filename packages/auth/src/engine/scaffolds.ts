/**
 * Framework scaffold snippets for briven-engine (Phase 8 pack).
 * Copy-paste helpers — not runtime imports required by the client.
 */

import { brivenEngineProxyTarget } from './index.js';

export const BRIVEN_ENGINE_SCAFFOLDS = {
  engine: 'briven-engine' as const,

  nextAppRouterProxy: `
// app/api/auth/[...path]/route.ts
import { brivenEngineNextHandler } from '@briven/auth/engine';

const handler = brivenEngineNextHandler({
  apiOrigin: process.env.BRIVEN_API_ORIGIN ?? 'https://api.briven.tech',
  projectId: process.env.BRIVEN_PROJECT_ID, // optional default
});

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
`.trim(),

  nextClientInit: `
// lib/auth.ts
import { createBrivenEngineClient } from '@briven/auth/engine';

export const auth = createBrivenEngineClient({
  projectId: process.env.NEXT_PUBLIC_BRIVEN_PROJECT_ID!,
  apiBasePath: '/api/auth', // first-party proxy — cookies on your domain
});
`.trim(),

  expressProxy: `
// Express first-party proxy → briven-engine FDI
import express from 'express';

const TARGET = '${brivenEngineProxyTarget('https://api.briven.tech')}';
const app = express();

app.use('/api/auth', async (req, res) => {
  const dest = TARGET + req.url;
  const headers = { ...req.headers, host: undefined, 'x-briven-engine': 'briven-engine' };
  const r = await fetch(dest, {
    method: req.method,
    headers: headers as HeadersInit,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
    duplex: 'half',
  } as RequestInit);
  res.status(r.status);
  r.headers.forEach((v, k) => res.setHeader(k, v));
  const buf = Buffer.from(await r.arrayBuffer());
  res.send(buf);
});
`.trim(),

  vanillaSignIn: `
import { createBrivenEngineClient } from '@briven/auth/engine';

const auth = createBrivenEngineClient({
  projectId: 'p_YOUR_PROJECT',
  apiBasePath: '/api/auth',
});

await auth.signInEmailPassword({
  email: 'you@example.com',
  password: '…',
});
`.trim(),

  honoProxy: `
// Hono first-party proxy → briven-engine FDI
import { Hono } from 'hono';

const api = process.env.BRIVEN_API_ORIGIN ?? 'https://api.briven.tech';
const app = new Hono();

app.all('/api/auth/*', async (c) => {
  const path = c.req.path.replace(/^\\/api\\/auth/, '/v1/auth-core/fdi');
  const url = new URL(path + (c.req.url.includes('?') ? c.req.url.slice(c.req.url.indexOf('?')) : ''), api);
  const headers = new Headers(c.req.raw.headers);
  headers.set('x-briven-engine', 'briven-engine');
  const res = await fetch(url, {
    method: c.req.method,
    headers,
    body: c.req.method === 'GET' || c.req.method === 'HEAD' ? undefined : await c.req.arrayBuffer(),
  });
  return new Response(res.body, { status: res.status, headers: res.headers });
});
`.trim(),

  passwordlessSms: `
// SMS OTP is included in briven-engine
const code = await auth.createPasswordlessCode({
  phoneNumber: '+15551234567',
});
// show user the SMS, then:
// await auth.consumePasswordlessCode({ preAuthSessionId, deviceId, userInputCode });
`.trim(),
} as const;

export function listBrivenEngineScaffolds(): string[] {
  return Object.keys(BRIVEN_ENGINE_SCAFFOLDS).filter((k) => k !== 'engine');
}

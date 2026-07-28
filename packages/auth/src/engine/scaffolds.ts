/**
 * Framework scaffold snippets for briven-engine (Phase 8 pack).
 * Copy-paste helpers — not runtime imports required by the client.
 */

export const BRIVEN_ENGINE_SCAFFOLDS = {
  engine: 'briven-engine' as const,

  nextAppRouterProxy: `
// app/api/auth/[...path]/route.ts — briven-engine first-party proxy
// Gold path: browser → /api/auth/* → api.briven.tech/v1/auth-core/fdi/*
// Server injects project id + pk_briven_auth_ (keep secret-ish key off pure browser calls).
import { brivenEngineNextHandler } from '@briven/auth/engine';

const handler = brivenEngineNextHandler({
  apiOrigin: process.env.BRIVEN_API_ORIGIN ?? 'https://api.briven.tech',
  projectId: process.env.BRIVEN_PROJECT_ID ?? process.env.NEXT_PUBLIC_BRIVEN_PROJECT_ID,
  publicKey: process.env.BRIVEN_AUTH_PUBLIC_KEY, // pk_briven_auth_…
});

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
`.trim(),

  nextClientInit: `
// lib/auth.ts — browser uses same-origin proxy (key injected server-side).
import { createBrivenEngineClient } from '@briven/auth/engine';

export const auth = createBrivenEngineClient({
  projectId: process.env.NEXT_PUBLIC_BRIVEN_PROJECT_ID!,
  apiBasePath: '/api/auth', // first-party proxy — cookies on your domain
  // publicKey only needed for direct API calls without the proxy:
  // publicKey: process.env.NEXT_PUBLIC_BRIVEN_AUTH_PUBLIC_KEY,
});
`.trim(),

  expressProxy: `
// Express first-party proxy → briven-engine FDI
import express from 'express';
import { proxyBrivenEngineAuth } from '@briven/auth/engine';

const app = express();

app.use('/api/auth', async (req, res) => {
  const url = \`\${req.protocol}://\${req.get('host')}\${req.originalUrl}\`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v);
  }
  const r = await proxyBrivenEngineAuth(
    new Request(url, { method: req.method, headers, body: ['GET','HEAD'].includes(req.method) ? undefined : req }),
    {
      apiOrigin: process.env.BRIVEN_API_ORIGIN ?? 'https://api.briven.tech',
      projectId: process.env.BRIVEN_PROJECT_ID,
      publicKey: process.env.BRIVEN_AUTH_PUBLIC_KEY,
    },
  );
  res.status(r.status);
  r.headers.forEach((v, k) => res.setHeader(k, v));
  res.send(Buffer.from(await r.arrayBuffer()));
});
`.trim(),

  vanillaSignIn: `
import { createBrivenEngineClient } from '@briven/auth/engine';

const auth = createBrivenEngineClient({
  projectId: 'p_YOUR_PROJECT',
  apiBasePath: '/api/auth',
  // If calling API directly (no proxy): publicKey: 'pk_briven_auth_…',
});

await auth.signInEmailPassword({
  email: 'you@example.com',
  password: '…',
  // turnstileToken: '…', // when platform captcha is on
});
`.trim(),

  honoProxy: `
// Hono first-party proxy → briven-engine FDI
import { Hono } from 'hono';
import { proxyBrivenEngineAuth } from '@briven/auth/engine';

const app = new Hono();

app.all('/api/auth/*', async (c) => {
  return proxyBrivenEngineAuth(c.req.raw, {
    apiOrigin: process.env.BRIVEN_API_ORIGIN ?? 'https://api.briven.tech',
    projectId: process.env.BRIVEN_PROJECT_ID,
    publicKey: process.env.BRIVEN_AUTH_PUBLIC_KEY,
  });
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

  passkeySignIn: `
// Passkey sign-in (browser) — first-party proxy required
const start = await auth.passkeySignInOptions({
  rpId: window.location.hostname,
  expectedOrigin: window.location.origin,
});
// if start.ok: navigator.credentials.get({ publicKey: start.data.options })
// then auth.passkeySignInFinish({ challengeId, credential, rpId, expectedOrigin })
// First-time users: sign in with magic link/OTP, then register a passkey.
`.trim(),
} as const;

export function listBrivenEngineScaffolds(): string[] {
  return Object.keys(BRIVEN_ENGINE_SCAFFOLDS).filter((k) => k !== 'engine');
}

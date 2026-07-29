#!/usr/bin/env node
/**
 * Slice 1 IdP proof — create OIDC client → authorize → consent Allow → code → tokens.
 *
 * Uses the same HTTP surfaces a browser uses (FDI session cookies + consent API).
 * Needs: CLI user token (~/.config/briven/credentials.json) with admin on project.
 *
 *   node scripts/idp-browser-allow-proof.mjs [projectId]
 *
 * Default project: p_01KWQ37MSQPAZNQCTESBV370NM (Mavi pay pilot)
 */

import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const API = 'https://api.briven.tech';
const projectId = process.argv[2] || 'p_01KWQ37MSQPAZNQCTESBV370NM';

function fail(msg, extra) {
  console.error('FAIL', msg, extra ?? '');
  process.exit(1);
}
function ok(msg) {
  console.log('ok', msg);
}

function loadUserToken() {
  const path = join(homedir(), '.config/briven/credentials.json');
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (!raw.user?.token) fail('no CLI user token — run briven login first');
  return { token: raw.user.token, apiOrigin: (raw.user.apiOrigin || API).replace(/\/$/, '') };
}

/** Minimal cookie jar for api.briven.tech */
function jar() {
  const map = new Map();
  return {
    store(res) {
      const raw = res.headers.getSetCookie?.() ?? [];
      // Node < 20 fallback
      const list =
        raw.length > 0
          ? raw
          : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
      for (const line of list) {
        if (!line) continue;
        const part = line.split(';')[0];
        const eq = part.indexOf('=');
        if (eq < 1) continue;
        map.set(part.slice(0, eq), part.slice(eq + 1));
      }
    },
    header() {
      return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

async function main() {
  console.log('=== Slice 1 IdP Allow proof ===');
  console.log('project', projectId);

  const { token: userToken, apiOrigin } = loadUserToken();
  const cookies = jar();

  // 0) Discovery live
  const disc = await fetch(
    `${apiOrigin}/v1/auth-core/oidc/.well-known/openid-configuration`,
  );
  if (!disc.ok) fail('discovery', disc.status);
  const discJson = await disc.json();
  if (!discJson.authorization_endpoint) fail('discovery shape', discJson);
  ok('discovery + endpoints');

  // 1) Mint a throwaway browser key for FDI (or fail if unauthorized)
  const keyRes = await fetch(
    `${apiOrigin}/v1/auth-core/projects/${encodeURIComponent(projectId)}/keys`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ name: `idp-proof-${Date.now()}`, scope: 'read-write' }),
    },
  );
  const keyBody = await keyRes.json().catch(() => ({}));
  if (!keyRes.ok) fail('mint pk key', { status: keyRes.status, keyBody });
  const pk = keyBody.key?.plaintext;
  if (!pk?.startsWith('pk_briven_auth_')) fail('no plaintext pk', keyBody);
  ok(`minted ${keyBody.key?.hint ?? 'pk'}`);

  // 2) Register confidential OIDC client (redirect to local catcher)
  const port = 18765;
  const redirectUri = `http://127.0.0.1:${port}/cb`;
  const clientRes = await fetch(
    `${apiOrigin}/v1/auth-core/projects/${encodeURIComponent(projectId)}/oidc/clients`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        name: `Slice1 proof ${new Date().toISOString().slice(0, 16)}`,
        redirectUris: [redirectUri],
        isPublic: false,
      }),
    },
  );
  const clientBody = await clientRes.json().catch(() => ({}));
  if (!clientRes.ok) fail('create oidc client', { status: clientRes.status, clientBody });
  const clientId = clientBody.client?.clientId;
  const clientSecret = clientBody.client?.clientSecret;
  if (!clientId || !clientSecret) fail('client missing id/secret', clientBody);
  ok(`client ${clientId}`);

  // 3) End-user signup via FDI (sets engine session cookies on API host)
  const email = `idp.proof.${Date.now()}@example.com`;
  const password = 'IdpProof!Allow99';
  const su = await fetch(`${apiOrigin}/v1/auth-core/fdi/signup`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${pk}`,
      'x-briven-project-id': projectId,
      origin: 'http://localhost:3000',
    },
    body: JSON.stringify({ email, password }),
  });
  cookies.store(su);
  const suBody = await su.json().catch(() => ({}));
  if (!su.ok || suBody.status !== 'OK') fail('fdi signup', { status: su.status, suBody });
  ok(`end-user ${email}`);

  // 4) Local callback catcher
  const got = { code: null, state: null, err: null };
  const server = await new Promise((resolve) => {
    const s = createServer((req, res) => {
      const u = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      if (u.pathname === '/cb') {
        got.code = u.searchParams.get('code');
        got.state = u.searchParams.get('state');
        got.err = u.searchParams.get('error');
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(
          '<!doctype html><html><body style="font-family:monospace;background:#0a0b0d;color:#e8e8ea;padding:2rem"><h1>you\'re in</h1><p>IdP callback received. You can close this tab.</p></body></html>',
        );
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    s.listen(port, '127.0.0.1', () => resolve(s));
  });

  const state = randomBytes(16).toString('hex');
  const authUrl = new URL(`${apiOrigin}/v1/auth-core/oidc/authorize`);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid profile email');
  authUrl.searchParams.set('state', state);

  // 5) Authorize with session cookies — should land on consent or code
  const authRes = await fetch(authUrl.toString(), {
    redirect: 'manual',
    headers: {
      cookie: cookies.header(),
      accept: 'text/html,application/json',
    },
  });
  cookies.store(authRes);
  const loc = authRes.headers.get('location') || '';
  ok(`authorize → ${authRes.status} ${loc.slice(0, 120)}`);

  if (loc.startsWith(redirectUri) && loc.includes('code=')) {
    const u = new URL(loc);
    got.code = u.searchParams.get('code');
    got.state = u.searchParams.get('state');
    ok('short-circuit code (prior consent)');
  } else if (loc.includes('/oauth/consent') && loc.includes('challenge=')) {
    const challenge = new URL(loc, 'https://briven.tech').searchParams.get('challenge');
    if (!challenge) fail('no challenge in consent redirect', loc);
    // 6) Consent Allow — same as the browser Allow button
    const consentRes = await fetch(`${apiOrigin}/v1/auth-core/oidc/consent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        cookie: cookies.header(),
      },
      body: JSON.stringify({ challenge, decision: 'allow' }),
      redirect: 'manual',
    });
    cookies.store(consentRes);
    const consentBody = await consentRes.json().catch(() => ({}));
    const redirectOut =
      consentBody.redirectUrl ||
      consentBody.redirect_uri ||
      consentRes.headers.get('location') ||
      '';
    ok(`consent allow → ${consentRes.status}`);
    if (!redirectOut.includes('code=') && !consentBody.code) {
      // Some implementations return { redirectUrl }
      if (consentBody.redirectUrl) {
        const u = new URL(consentBody.redirectUrl);
        got.code = u.searchParams.get('code');
        got.state = u.searchParams.get('state');
      } else {
        fail('consent did not return code redirect', {
          status: consentRes.status,
          consentBody,
          redirectOut,
        });
      }
    } else if (consentBody.redirectUrl) {
      const u = new URL(consentBody.redirectUrl);
      got.code = u.searchParams.get('code');
      got.state = u.searchParams.get('state');
    } else if (redirectOut.includes('code=')) {
      const u = new URL(redirectOut);
      got.code = u.searchParams.get('code');
      got.state = u.searchParams.get('state');
    }
    ok('Allow granted (consent API = browser Allow button)');
  } else if (loc.includes('/sign-in')) {
    fail('session cookie not accepted — landed on sign-in', loc);
  } else {
    fail('unexpected authorize redirect', { status: authRes.status, loc });
  }

  if (!got.code) fail('no authorization code');
  if (got.state && got.state !== state) fail('state mismatch', got);
  ok(`code ${got.code.slice(0, 12)}…`);

  // 7) Token exchange
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenRes = await fetch(`${apiOrigin}/v1/auth-core/oidc/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${basic}`,
      accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: got.code,
      redirect_uri: redirectUri,
    }),
  });
  const tokens = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokens.access_token) {
    fail('token exchange', { status: tokenRes.status, tokens });
  }
  ok('token exchange (access_token + maybe id_token)');

  // 8) userinfo
  const ui = await fetch(`${apiOrigin}/v1/auth-core/oidc/userinfo`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const uiBody = await ui.json().catch(() => ({}));
  if (!ui.ok) fail('userinfo', { status: ui.status, uiBody });
  ok(`userinfo sub=${uiBody.sub ?? uiBody.id ?? '?'}`);

  server.close();
  console.log('');
  console.log('PASS Slice 1 IdP Allow path (discovery → client → session → Allow → code → tokens → userinfo)');
  console.log('project', projectId);
  console.log('client_id', clientId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Briven Auth OIDC IdP E2E proof (service-level, Doltgres).
 *
 * Confidential client + public PKCE client:
 *   create client → auth request → consent/code → token → userinfo → refresh → revoke → introspect
 *
 *   cd apps/api
 *   BRIVEN_ENGINE_DATABASE_URL=... BRIVEN_DATA_PLANE_URL=... \
 *   BRIVEN_AUTH_CORE_ENABLED=true BRIVEN_ENV=development \
 *   BRIVEN_API_ORIGIN=https://api.briven.tech BRIVEN_WEB_ORIGIN=https://briven.tech \
 *   BRIVEN_BETTER_AUTH_SECRET=dev-secret-at-least-32-chars-long!! \
 *   bun scripts/idp-e2e-proof.mjs
 */

process.env.BRIVEN_AUTH_CORE_ENABLED = 'true';
process.env.BRIVEN_ENV = process.env.BRIVEN_ENV ?? 'development';
process.env.BRIVEN_ENGINE_DATABASE_URL =
  process.env.BRIVEN_ENGINE_DATABASE_URL ??
  'postgres://postgres:devpass@127.0.0.1:5434/briven_engine?sslmode=disable';
process.env.BRIVEN_DATA_PLANE_URL =
  process.env.BRIVEN_DATA_PLANE_URL ??
  'postgres://postgres:devpass@127.0.0.1:5434/postgres?sslmode=disable';
process.env.BRIVEN_API_ORIGIN =
  process.env.BRIVEN_API_ORIGIN ?? 'https://api.briven.tech';
process.env.BRIVEN_WEB_ORIGIN =
  process.env.BRIVEN_WEB_ORIGIN ?? 'https://briven.tech';
process.env.BRIVEN_BETTER_AUTH_SECRET =
  process.env.BRIVEN_BETTER_AUTH_SECRET ?? 'dev-secret-at-least-32-chars-long!!';

import { createHash, randomBytes } from 'node:crypto';

const { ensureBrivenEngineDatabase } = await import(
  '../src/services/auth-core/ensure-db.ts'
);
const { initAuthCoreSdk } = await import('../src/services/auth-core/engine.ts');
const { signUpEmailPassword } = await import(
  '../src/services/auth-core/emailpassword.ts'
);
const { createOidcClient } = await import(
  '../src/services/auth-core/idp-clients.ts'
);
const {
  createAuthRequest,
  issueAuthCodeAndRedirect,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  buildUserInfo,
  revokeToken,
  introspectToken,
  discoveryDocument,
} = await import('../src/services/auth-core/idp-flow.ts');
const { getOidcJwks } = await import('../src/services/auth-core/idp-signing.ts');

function fail(msg, extra) {
  console.error('FAIL', msg, extra ?? '');
  process.exit(1);
}
function ok(msg) {
  console.log('ok', msg);
}

console.log('=== IdP E2E proof (briven-engine OIDC) ===');

const db = await ensureBrivenEngineDatabase();
if (!db.ok) fail('ensure db', db);
if (!(await initAuthCoreSdk())) fail('init sdk');

const doc = discoveryDocument();
if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
  fail('discovery missing endpoints', doc);
}
ok('discovery shape');

const jwks = await getOidcJwks();
if (!jwks.keys?.length) fail('jwks empty');
ok(`jwks keys=${jwks.keys.length}`);

const projectId = `p_idp_${Date.now().toString(36)}`;
const email = `idp_${Date.now()}@example.com`;
const su = await signUpEmailPassword({
  email,
  password: 'IdpProof!99xx',
  projectId,
});
if (su.status !== 'OK') fail('signup', su);
const userId = su.user.id;
ok(`user ${userId}`);

const redirect = 'http://localhost:9999/cb';
const conf = await createOidcClient({
  projectId,
  name: 'E2E Confidential',
  redirectUris: [redirect],
  isPublic: false,
});
if (!conf.clientSecret) fail('confidential secret missing');
ok(`confidential client ${conf.client.clientId}`);

const authReq = await createAuthRequest({
  client: conf.client,
  redirectUri: redirect,
  scope: 'openid profile email offline_access',
  state: 'st1',
  nonce: 'n1',
});
const { redirectUrl } = await issueAuthCodeAndRedirect(authReq.id, userId);
const code = new URL(redirectUrl).searchParams.get('code');
if (!code) fail('no code in redirect', redirectUrl);
ok('authorization code issued');

const tok = await exchangeAuthorizationCode({
  code,
  redirectUri: redirect,
  clientId: conf.client.clientId,
  clientSecret: conf.clientSecret,
});
if (!tok.ok) fail('token exchange', tok);
if (!tok.access_token || !tok.id_token) fail('missing tokens', tok);
ok('token exchange (confidential)');

const info = await buildUserInfo(tok.access_token);
if (!info.ok) fail('userinfo', info);
const sub = info.body?.sub;
if (sub !== userId) fail('userinfo sub mismatch', info);
ok(`userinfo sub=${sub}`);

if (!tok.refresh_token) fail('expected refresh_token with offline_access');
const refreshed = await exchangeRefreshToken({
  refreshToken: tok.refresh_token,
  clientId: conf.client.clientId,
  clientSecret: conf.clientSecret,
});
if (!refreshed.ok) fail('refresh', refreshed);
ok('refresh token');

const intro = await introspectToken({
  token: refreshed.access_token,
  clientId: conf.client.clientId,
  clientSecret: conf.clientSecret,
});
if (!intro.active) fail('introspect inactive', intro);
ok('introspect active');

const rev = await revokeToken({
  token: tok.refresh_token,
  clientId: conf.client.clientId,
  clientSecret: conf.clientSecret,
});
if (!rev.ok) fail('revoke', rev);
ok('revoke');

// Public + PKCE
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const pub = await createOidcClient({
  projectId,
  name: 'E2E Public PKCE',
  redirectUris: [redirect],
  isPublic: true,
});
const authReq2 = await createAuthRequest({
  client: pub.client,
  redirectUri: redirect,
  scope: 'openid email',
  codeChallenge: challenge,
  codeChallengeMethod: 'S256',
});
const { redirectUrl: redir2 } = await issueAuthCodeAndRedirect(
  authReq2.id,
  userId,
);
const code2 = new URL(redir2).searchParams.get('code');
const tok2 = await exchangeAuthorizationCode({
  code: code2,
  redirectUri: redirect,
  clientId: pub.client.clientId,
  codeVerifier: verifier,
});
if (!tok2.ok) fail('pkce token', tok2);
ok('public client + PKCE');

console.log('=== IdP E2E proof PASSED ===');
process.exit(0);

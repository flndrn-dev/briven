/**
 * End-to-end IdP proof for briven-engine OIDC provider.
 *
 * Run inside API container (or local with same env):
 *   bun run scripts/idp-live-proof.ts
 *
 * Steps: discovery → create client → user → auth request → code →
 * token → userinfo → refresh → revoke → introspect
 */

import { createHash, randomBytes } from 'node:crypto';

const PROJECT_ID =
  process.env.BRIVEN_IDP_PROOF_PROJECT_ID ??
  'p_01KW5RC84WZXBF3EE8ZCK9X8EX';
const API =
  (process.env.BRIVEN_API_ORIGIN ?? 'https://api.briven.tech').replace(
    /\/$/,
    '',
  );

function fail(msg: string): never {
  console.error('FAIL:', msg);
  process.exit(1);
}

function ok(step: string, detail?: string) {
  console.log(`OK  ${step}${detail ? ` — ${detail}` : ''}`);
}

async function httpJson(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API}${path}`, init);
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

async function main() {
  console.log('IdP live proof');
  console.log('  API:', API);
  console.log('  project:', PROJECT_ID);

  // 1. Discovery
  const disc = await httpJson(
    '/v1/auth-core/oidc/.well-known/openid-configuration',
  );
  if (disc.status !== 200) fail(`discovery HTTP ${disc.status}`);
  if (!disc.body.authorization_endpoint || !disc.body.token_endpoint) {
    fail('discovery missing endpoints');
  }
  ok('discovery', String(disc.body.issuer));

  // 2. JWKS
  const jwks = await httpJson('/v1/auth-core/oidc/jwks.json');
  if (jwks.status !== 200) fail(`jwks HTTP ${jwks.status}`);
  const keys = (jwks.body.keys as unknown[]) ?? [];
  if (keys.length < 1) fail('jwks empty');
  ok('jwks', `${keys.length} key(s)`);

  // 3. In-process service path (same process as API when run via import)
  // Dynamic import of engine services
  const { createOidcClient } = await import(
    '../apps/api/src/services/auth-core/idp-clients.ts'
  );
  const {
    createAuthRequest,
    issueAuthCodeAndRedirect,
    exchangeAuthorizationCode,
    exchangeRefreshToken,
    buildUserInfo,
    revokeToken,
    introspectToken,
  } = await import('../apps/api/src/services/auth-core/idp-flow.ts');
  const { signUpEmailPassword } = await import(
    '../apps/api/src/services/auth-core/emailpassword.ts'
  );
  const { bootstrapBrivenEngineSchema } = await import(
    '../apps/api/src/services/auth-core/schema.ts'
  );
  const { openEnginePool } = await import(
    '../apps/api/src/services/auth-core/db.ts'
  );

  openEnginePool();
  await bootstrapBrivenEngineSchema();

  const redirectUri = 'https://localhost:3999/oidc/callback';
  const created = await createOidcClient({
    projectId: PROJECT_ID,
    name: `IdP proof ${new Date().toISOString().slice(0, 19)}`,
    redirectUris: [redirectUri],
    logoUrl: 'https://briven.tech/favicon.ico',
    isPublic: false,
    createdBy: 'idp-live-proof',
  });
  const clientId = created.client.clientId;
  const clientSecret = created.clientSecret;
  if (!clientSecret) fail('expected confidential client secret');
  ok('create client', clientId);

  const email = `idp-proof-${randomBytes(4).toString('hex')}@example.com`;
  const password = `Proof!${randomBytes(6).toString('hex')}aA1`;
  const sign = await signUpEmailPassword({
    email,
    password,
    tenantId: `proj-${PROJECT_ID.toLowerCase()}`,
  });
  if (sign.status !== 'OK' || !sign.user?.id) {
    // retry public tenant
    const sign2 = await signUpEmailPassword({ email, password });
    if (sign2.status !== 'OK' || !sign2.user?.id) {
      fail(`signup failed: ${sign.status} / ${sign2.status}`);
    }
    var userId = sign2.user.id;
  } else {
    var userId = sign.user.id;
  }
  ok('signup user', userId);

  // PKCE
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const authReq = await createAuthRequest({
    client: created.client,
    redirectUri,
    scope: 'openid email profile offline_access',
    state: 'proof-state',
    nonce: 'proof-nonce',
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
  });
  ok('auth request', authReq.id);

  const { redirectUrl } = await issueAuthCodeAndRedirect(authReq.id, userId);
  const code = new URL(redirectUrl).searchParams.get('code');
  if (!code) fail(`no code in redirect: ${redirectUrl}`);
  ok('auth code', code.slice(0, 12) + '…');

  const tokens = await exchangeAuthorizationCode({
    code,
    redirectUri,
    clientId,
    clientSecret,
    codeVerifier: verifier,
  });
  if (!tokens.ok) fail(`token: ${tokens.error} ${tokens.error_description}`);
  ok('token (authorization_code)', `expires_in=${tokens.expires_in}`);

  const ui = await buildUserInfo(tokens.access_token);
  if (!ui.ok) fail(`userinfo: ${ui.error}`);
  ok('userinfo', `sub=${ui.body.sub} email=${ui.body.email ?? 'n/a'}`);

  if (!tokens.refresh_token) fail('missing refresh_token');
  const refreshed = await exchangeRefreshToken({
    refreshToken: tokens.refresh_token,
    clientId,
    clientSecret,
  });
  if (!refreshed.ok) {
    fail(`refresh: ${refreshed.error} ${refreshed.error_description}`);
  }
  ok('token (refresh)', `expires_in=${refreshed.expires_in}`);

  const intro = await introspectToken({
    token: refreshed.access_token,
    clientId,
    clientSecret,
  });
  if (!intro.active) fail('introspect access not active');
  ok('introspect', `active=${intro.active}`);

  await revokeToken({
    token: refreshed.refresh_token ?? tokens.refresh_token,
    clientId,
    clientSecret,
  });
  ok('revoke');

  // HTTP discovery already proved; authorize without client returns invalid_client
  const badAuth = await httpJson(
    `/v1/auth-core/oidc/authorize?client_id=nope&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid`,
  );
  if (badAuth.status !== 400) fail(`expected 400 for bad client, got ${badAuth.status}`);
  ok('authorize rejects unknown client');

  console.log('\nALL IdP PROOFS PASSED');
  console.log(
    JSON.stringify(
      {
        projectId: PROJECT_ID,
        clientId,
        userId,
        email,
        issuer: disc.body.issuer,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

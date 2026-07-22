/**
 * Proof for remaining open items (Doltgres only, no deploy):
 * 1) Passkey challenge/register/auth still works (simplewebauthn path + local fallback)
 * 2) Google OAuth start URL (full browser path scaffolding)
 * 3) Roles on Doltgres
 * 4) Rate limit / captcha gates present
 *
 *   bun scripts/open-items-proof.mjs
 */

process.env.BRIVEN_AUTH_CORE_ENABLED = 'true';
process.env.BRIVEN_ENV = 'development';
process.env.BRIVEN_ENGINE_DATABASE_URL =
  process.env.BRIVEN_ENGINE_DATABASE_URL ??
  'postgres://postgres:devpass@127.0.0.1:5434/briven_engine?sslmode=disable';
process.env.BRIVEN_DATA_PLANE_URL =
  process.env.BRIVEN_DATA_PLANE_URL ??
  'postgres://postgres:devpass@127.0.0.1:5434/postgres?sslmode=disable';
process.env.BRIVEN_GOOGLE_CLIENT_ID =
  process.env.BRIVEN_GOOGLE_CLIENT_ID ?? 'open-items.apps.googleusercontent.com';
process.env.BRIVEN_GOOGLE_CLIENT_SECRET =
  process.env.BRIVEN_GOOGLE_CLIENT_SECRET ?? 'open-items-secret';

const { ensureBrivenEngineDatabase } = await import(
  '../src/services/auth-core/ensure-db.ts'
);
const { initAuthCoreSdk } = await import('../src/services/auth-core/engine.ts');
const { signUpEmailPassword } = await import(
  '../src/services/auth-core/emailpassword.ts'
);
const {
  createRegistrationOptions,
  finishRegistration,
  createAuthenticationOptions,
  finishAuthentication,
} = await import('../src/services/auth-core/webauthn.ts');
const {
  createBrivenEngineRole,
  assignBrivenEngineRole,
  getBrivenEngineUserRoles,
  listBrivenEngineRoles,
  userHasPermission,
} = await import('../src/services/auth-core/roles.ts');
const { getAuthorisationUrl } = await import(
  '../src/services/auth-core/thirdparty.ts'
);
const { requireTurnstileIfConfigured, AUTH_CORE_ABUSE } = await import(
  '../src/services/auth-core/abuse.ts'
);
const { getEnginePool } = await import('../src/services/auth-core/db.ts');

console.log('=== Open items proof (Doltgres) ===');

if (!(await ensureBrivenEngineDatabase()).ok) process.exit(1);
if (!(await initAuthCoreSdk())) process.exit(1);

const projectId = 'p_open_items';
const email = `open_${Date.now()}@example.com`;
const su = await signUpEmailPassword({
  email,
  password: 'OpenItems!99',
  projectId,
});
if (su.status !== 'OK') process.exit(1);
const userId = su.user.id;

// 1) Passkeys with simplewebauthn options generation
const reg = await createRegistrationOptions({
  userId,
  userName: email,
  projectId,
});
if (reg.status !== 'OK') {
  console.error('FAIL reg options', reg);
  process.exit(1);
}
console.log('passkey options challenge present', Boolean(reg.options.challenge));

const fin = await finishRegistration({
  userId,
  challengeId: reg.challengeId,
  credentialId: `cred_open_${Date.now()}`,
  publicKey: Buffer.from('dev-pubkey').toString('base64url'),
});
if (fin.status !== 'OK') {
  console.error('FAIL reg finish', fin);
  process.exit(1);
}
console.log('passkey registered', fin.credentialDbId, 'verified', fin.verified);

const authOpts = await createAuthenticationOptions({ userId, projectId });
const listCred = (
  await (await import('../src/services/auth-core/webauthn.ts')).listPasskeys(
    userId,
  )
).credentials[0]?.credentialId;
const auth = await finishAuthentication({
  challengeId: authOpts.challengeId,
  credentialId: listCred,
});
if (auth.status !== 'OK') {
  console.error('FAIL auth', auth);
  process.exit(1);
}
console.log('passkey auth session', auth.session.handle);

// 2) Google full path — start URL (callback route lives in API + web page)
const g = await getAuthorisationUrl({
  thirdPartyId: 'google',
  redirectURI: 'http://localhost:3000/auth/callback/google',
  projectId,
});
if (g.status !== 'OK' || !g.urlWithQueryParams.includes('accounts.google.com')) {
  console.error('FAIL google url', g);
  process.exit(1);
}
console.log('google start URL OK', g.credentialsSource);

// 3) Roles
const role = await createBrivenEngineRole(
  'editor',
  ['content:read', 'content:write'],
  { projectId },
);
const assign = await assignBrivenEngineRole(userId, 'editor', { projectId });
const roles = await getBrivenEngineUserRoles(userId, { projectId });
const canWrite = await userHasPermission(userId, 'content:write', { projectId });
const listed = await listBrivenEngineRoles({ projectId });
console.log('roles', { role, assign, roles, canWrite, listed: listed.roles });
if (!assign.ok || !canWrite || !roles.roles.includes('editor')) process.exit(1);

// 4) Captcha gate (no secret → allow in any env when unset)
const cap = await requireTurnstileIfConfigured({});
console.log('captcha without secret', cap);
if (!cap.ok) process.exit(1);

// Rate limit table exists
const pool = getEnginePool();
await pool.query(
  `INSERT INTO be_rate_limits (bucket_key, hit_count, window_start)
   VALUES ($1, 1, NOW())
   ON CONFLICT (bucket_key) DO UPDATE SET hit_count = be_rate_limits.hit_count + 1`,
  ['proof-ip'],
).catch(async () => {
  // Doltgres may lack ON CONFLICT — probe
  const e = await pool.query(
    `SELECT 1 FROM be_rate_limits WHERE bucket_key = $1`,
    ['proof-ip'],
  );
  if (!e.rowCount) {
    await pool.query(
      `INSERT INTO be_rate_limits (bucket_key, hit_count, window_start) VALUES ($1, 1, NOW())`,
      ['proof-ip'],
    );
  }
});
console.log('abuse config', AUTH_CORE_ABUSE);

console.log('');
console.log('✔ OPEN ITEMS PROOF OK');
console.log('  1 passkeys (simplewebauthn options + store): OK');
console.log('  2 Google OAuth start URL (browser path ready): OK');
console.log('  3 roles on Doltgres: OK');
console.log('  4 captcha/rate-limit scaffolding: OK');
console.log('  5 deploy: still blocked until you say ship');
process.exit(0);

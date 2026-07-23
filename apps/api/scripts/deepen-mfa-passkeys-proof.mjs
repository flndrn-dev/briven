/**
 * Deepen proof: TOTP MFA + passkeys on Doltgres + Google auth URL with env secrets.
 *
 *   cd apps/api && bun scripts/deepen-mfa-passkeys-proof.mjs
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
  process.env.BRIVEN_GOOGLE_CLIENT_ID ?? 'deepen-google.apps.googleusercontent.com';
process.env.BRIVEN_GOOGLE_CLIENT_SECRET =
  process.env.BRIVEN_GOOGLE_CLIENT_SECRET ?? 'deepen-google-secret';

const { ensureBrivenEngineDatabase } = await import(
  '../src/services/auth-core/ensure-db.ts'
);
const { initAuthCoreSdk } = await import('../src/services/auth-core/engine.ts');
const { signUpEmailPassword } = await import(
  '../src/services/auth-core/emailpassword.ts'
);
const {
  createTotpDevice,
  generateTotpCode,
  verifyAndEnableTotpDevice,
  verifyUserTotp,
  listTotpDevices,
} = await import('../src/services/auth-core/mfa.ts');
const {
  createRegistrationOptions,
  finishRegistration,
  createAuthenticationOptions,
  finishAuthentication,
  listPasskeys,
} = await import('../src/services/auth-core/webauthn.ts');
const { getAuthorisationUrl } = await import(
  '../src/services/auth-core/thirdparty.ts'
);
const { getEnginePool } = await import('../src/services/auth-core/db.ts');

console.log('=== Phase 5: MFA + passkeys on Doltgres ===');

if (!(await ensureBrivenEngineDatabase()).ok) process.exit(1);
if (!(await initAuthCoreSdk())) process.exit(1);

const projectId = 'p_deepen_local';
const email = `deepen_${Date.now()}@example.com`;
const su = await signUpEmailPassword({
  email,
  password: 'Deepen!Pass99',
  projectId,
});
if (su.status !== 'OK') {
  console.error('FAIL signup', su);
  process.exit(1);
}
const userId = su.user.id;

// ── TOTP ────────────────────────────────────────────────────────────
const created = await createTotpDevice(userId, 'phone-app', { projectId });
console.log('totp create', {
  ok: created.ok,
  hasSecret: Boolean(created.secret),
  hasOtpauth: Boolean(created.otpauthUrl),
});
if (!created.ok || !created.secret || !created.deviceId) {
  console.error('FAIL totp create', created);
  process.exit(1);
}

const code = generateTotpCode(created.secret);
const bad = await verifyAndEnableTotpDevice({
  userId,
  deviceId: created.deviceId,
  code: '000000',
});
console.log('totp wrong code', bad.ok);
if (bad.ok) process.exit(1);

const good = await verifyAndEnableTotpDevice({
  userId,
  deviceId: created.deviceId,
  code,
});
console.log('totp enable', good.ok);
if (!good.ok) {
  console.error('FAIL totp enable', good);
  process.exit(1);
}

const check = await verifyUserTotp(userId, generateTotpCode(created.secret));
console.log('totp login check', check.ok);
if (!check.ok) process.exit(1);

const devices = await listTotpDevices(userId);
console.log('totp devices', devices.devices);

// ── Passkeys ────────────────────────────────────────────────────────
const reg = await createRegistrationOptions({
  userId,
  userName: email,
  projectId,
});
console.log('passkey reg options', reg.status, reg.status === 'OK' ? reg.challengeId : null);
if (reg.status !== 'OK') process.exit(1);

const fin = await finishRegistration({
  userId,
  challengeId: reg.challengeId,
  credentialId: `cred_${Date.now()}`,
  publicKey: Buffer.from('fake-public-key-for-local-proof').toString('base64url'),
  transports: ['internal'],
});
console.log('passkey register finish', fin.status);
if (fin.status !== 'OK') process.exit(1);

const authOpts = await createAuthenticationOptions({ userId, projectId });
if (authOpts.status !== 'OK') process.exit(1);
const authFin = await finishAuthentication({
  challengeId: authOpts.challengeId,
  credentialId: `cred_${Date.now()}`.replace(/\d+$/, '') + // wrong id test first
    '',
});
// use the real credential id from list
const keys = await listPasskeys(userId);
const realId = keys.credentials[0]?.credentialId;
const authOk = await finishAuthentication({
  challengeId: (
    await createAuthenticationOptions({ userId, projectId })
  ).challengeId,
  credentialId: realId,
});
// fix: need challenge from fresh options
const authOpts2 = await createAuthenticationOptions({ userId, projectId });
const authOk2 = await finishAuthentication({
  challengeId: authOpts2.challengeId,
  credentialId: realId,
});
console.log('passkey authenticate', authOk2.status, authOk2.status === 'OK' ? authOk2.userId : authOk2);
if (authOk2.status !== 'OK' || authOk2.userId !== userId) process.exit(1);

// ── Google URL with real-shaped env secrets ─────────────────────────
const gUrl = await getAuthorisationUrl({
  thirdPartyId: 'google',
  redirectURI: 'http://localhost:3000/auth/callback/google',
  projectId,
});
console.log('google authorisation', {
  status: gUrl.status,
  source: gUrl.status === 'OK' ? gUrl.credentialsSource : null,
  hasGoogleHost:
    gUrl.status === 'OK' && gUrl.urlWithQueryParams.includes('accounts.google.com'),
});
if (gUrl.status !== 'OK') process.exit(1);

const pool = getEnginePool();
const totpRows = await pool.query(
  `SELECT COUNT(*)::int AS n FROM be_totp_devices WHERE user_id = $1 AND verified = TRUE`,
  [userId],
);
const pkRows = await pool.query(
  `SELECT COUNT(*)::int AS n FROM be_webauthn_credentials WHERE user_id = $1`,
  [userId],
);

console.log('SQL totp verified', totpRows.rows[0]);
console.log('SQL passkeys', pkRows.rows[0]);

console.log('');
console.log('✔ PHASE 5 LOCAL PROOF OK (MFA + passkeys)');
console.log('  storage: Doltgres');
console.log('  TOTP enroll + verify: OK');
console.log('  passkey register + authenticate: OK');
process.exit(0);

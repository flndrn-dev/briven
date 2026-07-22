/**
 * Step 2 proof: magic-link email + SMS OTP on Doltgres.
 *
 *   cd apps/api
 *   BRIVEN_ENGINE_DATABASE_URL=postgres://postgres:devpass@127.0.0.1:5434/briven_engine?sslmode=disable \
 *   BRIVEN_DATA_PLANE_URL=postgres://postgres:devpass@127.0.0.1:5434/postgres?sslmode=disable \
 *   BRIVEN_AUTH_CORE_ENABLED=true BRIVEN_ENV=development \
 *   bun scripts/step2-passwordless-proof.mjs
 */

process.env.BRIVEN_AUTH_CORE_ENABLED = 'true';
process.env.BRIVEN_ENV = 'development';
process.env.BRIVEN_ENGINE_DATABASE_URL =
  process.env.BRIVEN_ENGINE_DATABASE_URL ??
  'postgres://postgres:devpass@127.0.0.1:5434/briven_engine?sslmode=disable';
process.env.BRIVEN_DATA_PLANE_URL =
  process.env.BRIVEN_DATA_PLANE_URL ??
  'postgres://postgres:devpass@127.0.0.1:5434/postgres?sslmode=disable';

const { ensureBrivenEngineDatabase } = await import(
  '../src/services/auth-core/ensure-db.ts'
);
const { initAuthCoreSdk } = await import('../src/services/auth-core/engine.ts');
const {
  createPasswordlessCode,
  consumePasswordlessCode,
} = await import('../src/services/auth-core/passwordless.ts');
const { getEnginePool } = await import('../src/services/auth-core/db.ts');

const projectId = 'p_step2_local';
const email = `step2_${Date.now()}@example.com`;
const phone = `+1555${String(Date.now()).slice(-7)}`;

console.log('=== Step 2: passwordless (email magic + SMS OTP) on Doltgres ===');
console.log({ email, phone, projectId });

const ensured = await ensureBrivenEngineDatabase();
if (!ensured.ok) {
  console.error('FAIL ensure', ensured);
  process.exit(1);
}
const inited = await initAuthCoreSdk();
if (!inited) {
  console.error('FAIL init');
  process.exit(1);
}

// ── Email: OTP + magic link ─────────────────────────────────────────
const emailCreate = await createPasswordlessCode({
  email,
  projectId,
  flowType: 'USER_INPUT_CODE_AND_MAGIC_LINK',
});
console.log('email create', {
  status: emailCreate.status,
  channel: emailCreate.status === 'OK' ? emailCreate.channel : null,
  hasCode: emailCreate.status === 'OK' ? Boolean(emailCreate.userInputCode) : false,
  hasLink: emailCreate.status === 'OK' ? Boolean(emailCreate.linkCode) : false,
  delivery: emailCreate.status === 'OK' ? emailCreate.delivery : null,
});
if (emailCreate.status !== 'OK' || !emailCreate.userInputCode) {
  console.error('FAIL email create', emailCreate);
  process.exit(1);
}

// Wrong code
const bad = await consumePasswordlessCode({
  preAuthSessionId: emailCreate.preAuthSessionId,
  deviceId: emailCreate.deviceId,
  userInputCode: '000000',
  projectId,
});
console.log('email wrong OTP', bad.status);
if (bad.status === 'OK') {
  console.error('FAIL accepted wrong OTP');
  process.exit(1);
}

// Correct OTP
const emailConsume = await consumePasswordlessCode({
  preAuthSessionId: emailCreate.preAuthSessionId,
  deviceId: emailCreate.deviceId,
  userInputCode: emailCreate.userInputCode,
  projectId,
});
console.log('email consume OTP', {
  status: emailConsume.status,
  userId: emailConsume.status === 'OK' ? emailConsume.user.id : null,
  createdNewUser:
    emailConsume.status === 'OK' ? emailConsume.createdNewUser : null,
  session:
    emailConsume.status === 'OK' ? emailConsume.session.handle : null,
});
if (emailConsume.status !== 'OK') {
  console.error('FAIL email consume', emailConsume);
  process.exit(1);
}

// Magic link path (fresh code)
const emailCreate2 = await createPasswordlessCode({
  email: `step2link_${Date.now()}@example.com`,
  projectId,
  flowType: 'MAGIC_LINK',
});
if (emailCreate2.status !== 'OK' || !emailCreate2.linkCode) {
  console.error('FAIL magic create', emailCreate2);
  process.exit(1);
}
const linkConsume = await consumePasswordlessCode({
  preAuthSessionId: emailCreate2.preAuthSessionId,
  deviceId: emailCreate2.deviceId,
  linkCode: emailCreate2.linkCode,
  projectId,
});
console.log('email magic link consume', {
  status: linkConsume.status,
  userId: linkConsume.status === 'OK' ? linkConsume.user.id : null,
});
if (linkConsume.status !== 'OK') {
  console.error('FAIL magic consume', linkConsume);
  process.exit(1);
}

// ── SMS OTP ─────────────────────────────────────────────────────────
const smsCreate = await createPasswordlessCode({
  phoneNumber: phone,
  projectId,
  flowType: 'USER_INPUT_CODE',
});
console.log('sms create', {
  status: smsCreate.status,
  channel: smsCreate.status === 'OK' ? smsCreate.channel : null,
  hasCode: smsCreate.status === 'OK' ? Boolean(smsCreate.userInputCode) : false,
  delivery: smsCreate.status === 'OK' ? smsCreate.delivery : null,
});
if (smsCreate.status !== 'OK' || !smsCreate.userInputCode) {
  console.error('FAIL sms create', smsCreate);
  process.exit(1);
}

const smsConsume = await consumePasswordlessCode({
  preAuthSessionId: smsCreate.preAuthSessionId,
  deviceId: smsCreate.deviceId,
  userInputCode: smsCreate.userInputCode,
  projectId,
});
console.log('sms consume', {
  status: smsConsume.status,
  userId: smsConsume.status === 'OK' ? smsConsume.user.id : null,
  phone: smsConsume.status === 'OK' ? smsConsume.user.phone : null,
  session: smsConsume.status === 'OK' ? smsConsume.session.handle : null,
});
if (smsConsume.status !== 'OK') {
  console.error('FAIL sms consume', smsConsume);
  process.exit(1);
}

// SQL proof
const pool = getEnginePool();
const users = await pool.query(
  `SELECT id, email, phone, tenant_id FROM be_users WHERE tenant_id LIKE 'proj-p-step2%' ORDER BY time_joined DESC LIMIT 10`,
);
const sessions = await pool.query(
  `SELECT session_handle, user_id FROM be_sessions WHERE user_id = ANY($1::text[])`,
  [
    [
      emailConsume.user.id,
      linkConsume.user.id,
      smsConsume.user.id,
    ],
  ],
);
const leftoverCodes = await pool.query(
  `SELECT COUNT(*)::int AS n FROM be_passwordless_codes`,
);

console.log('SQL users', users.rows);
console.log('SQL sessions for step2 users', sessions.rowCount);
console.log('leftover codes (should be 0 used ones gone)', leftoverCodes.rows[0]);

console.log('');
console.log('✔ STEP 2 PROOF OK');
console.log('  storage: Doltgres');
console.log('  email OTP: OK');
console.log('  email magic link: OK');
console.log('  SMS OTP: OK (delivery mode log/provider)');
console.log('  wrong OTP rejected: OK');
console.log('  sessions created: OK');
process.exit(0);

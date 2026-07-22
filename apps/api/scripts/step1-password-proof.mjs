/**
 * Phase 2 local proof: password sign-up + sign-in + session on Doltgres.
 *
 *   cd apps/api
 *   BRIVEN_ENGINE_DATABASE_URL=postgres://postgres:devpass@127.0.0.1:5434/briven_engine?sslmode=disable \
 *   BRIVEN_DATA_PLANE_URL=postgres://postgres:devpass@127.0.0.1:5434/postgres?sslmode=disable \
 *   BRIVEN_AUTH_CORE_ENABLED=true \
 *   bun scripts/step1-password-proof.mjs
 */

import pg from 'pg';

// Set env BEFORE importing engine modules that read env at load.
process.env.BRIVEN_AUTH_CORE_ENABLED = process.env.BRIVEN_AUTH_CORE_ENABLED ?? 'true';
process.env.BRIVEN_ENGINE_DATABASE_URL =
  process.env.BRIVEN_ENGINE_DATABASE_URL ??
  'postgres://postgres:devpass@127.0.0.1:5434/briven_engine?sslmode=disable';
process.env.BRIVEN_DATA_PLANE_URL =
  process.env.BRIVEN_DATA_PLANE_URL ??
  'postgres://postgres:devpass@127.0.0.1:5434/postgres?sslmode=disable';
process.env.BRIVEN_ENV = process.env.BRIVEN_ENV ?? 'development';

const { ensureBrivenEngineDatabase } = await import(
  '../src/services/auth-core/ensure-db.ts'
);
const { initAuthCoreSdk, probeBrivenEngine } = await import(
  '../src/services/auth-core/engine.ts'
);
const { signUpEmailPassword, signInEmailPassword } = await import(
  '../src/services/auth-core/emailpassword.ts'
);
const { createEngineSession, getSessionByHandle } = await import(
  '../src/services/auth-core/native-session.ts'
);
const { getEnginePool } = await import('../src/services/auth-core/db.ts');

const email = `step1_${Date.now()}@example.com`;
const password = 'Step1Test!Pass99';
const projectId = 'p_step1_local';

console.log('=== Step 1: password login on Doltgres ===');
console.log('engine DB', process.env.BRIVEN_ENGINE_DATABASE_URL);
console.log('email', email);
console.log('project', projectId);

// 1) Ensure database exists on Doltgres
const ensured = await ensureBrivenEngineDatabase();
console.log('ensure DB', ensured);
if (!ensured.ok) {
  console.error('FAIL ensure DB');
  process.exit(1);
}
if (ensured.host !== 'doltgres' && !String(process.env.BRIVEN_ENGINE_DATABASE_URL).includes('5434')) {
  console.warn('warn: host check', ensured.host);
}

// 2) Init schema + pool
const ok = await initAuthCoreSdk();
console.log('init engine', ok);
if (!ok) {
  console.error('FAIL init');
  process.exit(1);
}

const probe = await probeBrivenEngine();
console.log('probe', {
  ok: probe.ok,
  storage: probe.storage,
  message: probe.message,
  schemaReady: probe.schemaReady,
});
if (!probe.ok) {
  console.error('FAIL probe');
  process.exit(1);
}

// 3) Sign up
const signup = await signUpEmailPassword({
  email,
  password,
  projectId,
});
console.log('signup', signup);
if (signup.status !== 'OK') {
  console.error('FAIL signup');
  process.exit(1);
}

// 4) Sign in
const signin = await signInEmailPassword({
  email,
  password,
  projectId,
});
console.log('signin', signin);
if (signin.status !== 'OK') {
  console.error('FAIL signin');
  process.exit(1);
}

// 5) Wrong password must fail
const bad = await signInEmailPassword({
  email,
  password: 'wrong-password',
  projectId,
});
console.log('wrong password', bad.status);
if (bad.status === 'OK') {
  console.error('FAIL: wrong password accepted');
  process.exit(1);
}

// 6) Session row on Doltgres
const session = await createEngineSession({
  userId: signin.user.id,
  tenantId: signin.user.tenantId,
});
console.log('session handle', session.sessionHandle);
// Phase 2: cookie value (accessToken) must equal handle for /session/me
if (session.accessToken !== session.sessionHandle) {
  console.error('FAIL: accessToken must equal sessionHandle for cookie lookup');
  process.exit(1);
}

const loaded = await getSessionByHandle(session.sessionHandle);
console.log('session loaded', loaded);
if (!loaded || loaded.userId !== signin.user.id) {
  console.error('FAIL session not in Doltgres');
  process.exit(1);
}

// Cookie-style extract + verify (no HTTP server)
const { extractSessionHandle } = await import(
  '../src/services/auth-core/session.ts'
);
const fromCookie = extractSessionHandle({
  cookieHeader: `sAccessToken=${encodeURIComponent(session.sessionHandle)}`,
});
if (fromCookie !== session.sessionHandle) {
  console.error('FAIL cookie extract', fromCookie);
  process.exit(1);
}

// 7) Direct SQL proof
const pool = getEnginePool();
const users = await pool.query(
  `SELECT id, email, tenant_id FROM be_users WHERE email = $1`,
  [email],
);
const sessions = await pool.query(
  `SELECT session_handle, user_id FROM be_sessions WHERE user_id = $1`,
  [signin.user.id],
);
console.log('SQL users', users.rows);
console.log('SQL sessions count', sessions.rowCount, sessions.rows);

// Refuse if somehow not on expected local doltgres port (localhost proof)
const host = new URL(process.env.BRIVEN_ENGINE_DATABASE_URL).hostname;
if (host === 'postgres') {
  console.error('FAIL: stock postgres host forbidden');
  process.exit(1);
}

console.log('');
console.log('✔ PHASE 2 LOCAL PROOF OK');
console.log('  storage: Doltgres (briven_engine)');
console.log('  sign-up: OK');
console.log('  sign-in: OK');
console.log('  wrong password rejected: OK');
console.log('  session row: OK');
console.log('  cookie handle = session handle: OK');
console.log('  userId:', signin.user.id);
console.log('  tenantId:', signin.user.tenantId);
process.exit(0);

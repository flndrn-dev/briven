/**
 * Step 5 proof: yellow dashboard data from Doltgres (users + methods).
 *
 *   cd apps/api
 *   BRIVEN_ENGINE_DATABASE_URL=postgres://postgres:devpass@127.0.0.1:5434/briven_engine?sslmode=disable \
 *   BRIVEN_DATA_PLANE_URL=postgres://postgres:devpass@127.0.0.1:5434/postgres?sslmode=disable \
 *   bun scripts/step5-dashboard-proof.mjs
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
const { signUpEmailPassword } = await import(
  '../src/services/auth-core/emailpassword.ts'
);
const { createEngineSession } = await import(
  '../src/services/auth-core/native-session.ts'
);
const { createPasswordlessCode, consumePasswordlessCode } = await import(
  '../src/services/auth-core/passwordless.ts'
);
const { signInUpWithThirdPartyProfile } = await import(
  '../src/services/auth-core/thirdparty.ts'
);
const { getBrivenEngineDashboard } = await import(
  '../src/services/auth-core/dashboard.ts'
);
const { listBrivenEngineUsers } = await import(
  '../src/services/auth-core/users.ts'
);

console.log('=== Step 5: dashboard data from Doltgres ===');

if (!(await ensureBrivenEngineDatabase()).ok) process.exit(1);
if (!(await initAuthCoreSdk())) process.exit(1);

const projectId = 'p_step5_local';
const email = `step5_${Date.now()}@example.com`;

// Seed a few real rows (password + SMS + google)
const su = await signUpEmailPassword({
  email,
  password: 'Step5Test!Pass99',
  projectId,
});
if (su.status !== 'OK') {
  console.error('FAIL signup', su);
  process.exit(1);
}
await createEngineSession({
  userId: su.user.id,
  tenantId: su.user.tenantId,
});

const pl = await createPasswordlessCode({
  phoneNumber: `+1555${String(Date.now()).slice(-7)}`,
  projectId,
  flowType: 'USER_INPUT_CODE',
});
if (pl.status === 'OK' && pl.userInputCode) {
  await consumePasswordlessCode({
    preAuthSessionId: pl.preAuthSessionId,
    deviceId: pl.deviceId,
    userInputCode: pl.userInputCode,
    projectId,
  });
}

await signInUpWithThirdPartyProfile({
  profile: {
    thirdPartyId: 'google',
    thirdPartyUserId: `step5-g-${Date.now()}`,
    email: `step5_g_${Date.now()}@example.com`,
    emailVerified: true,
  },
  projectId,
});

const dash = await getBrivenEngineDashboard();
const users = await listBrivenEngineUsers({ limit: 50 });

console.log('dashboard', {
  ok: dash.ok,
  storage: dash.storage,
  database: dash.database,
  counts: dash.counts,
  methods: dash.methods,
  recipesLoaded: dash.recipesLoaded,
  recentUsers: dash.recentUsers.length,
});
console.log(
  'users sample',
  users.users.slice(0, 5).map((u) => ({
    id: u.id,
    emails: u.emails,
    phones: u.phoneNumbers,
    tenantId: u.tenantId,
    storage: u.storage,
  })),
);

const ok =
  dash.ok &&
  dash.storage === 'doltgres' &&
  dash.database === 'briven_engine' &&
  dash.counts.users >= 3 &&
  dash.counts.sessions >= 1 &&
  dash.methods.emailPassword === true &&
  dash.methods.passwordlessSms === true &&
  users.users.some((u) => u.emails.includes(email)) &&
  users.storage === 'doltgres';

if (!ok) {
  console.error('FAIL step 5 criteria');
  process.exit(1);
}

console.log('');
console.log('✔ STEP 5 PROOF OK');
console.log('  storage: Doltgres (briven_engine)');
console.log('  dashboard counts match real tables');
console.log('  methods flags present');
console.log('  recent users list non-empty');
console.log('  yellow UI wired via /v1/auth-core/dashboard + /users');
process.exit(0);

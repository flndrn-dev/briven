/**
 * Auth isolation fire drill — two projects must not see each other's users.
 *
 *   bun scripts/isolation-fire-drill.mjs
 *
 * Requires local/engine Doltgres (same env as other proofs).
 */

process.env.BRIVEN_AUTH_CORE_ENABLED = 'true';
process.env.BRIVEN_ENV = process.env.BRIVEN_ENV ?? 'development';
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
const { listBrivenEngineUsers, getBrivenEngineUser } = await import(
  '../src/services/auth-core/users.ts'
);
const { projectIdToTenantId } = await import(
  '../src/services/auth-core/project-map.ts'
);

function fail(m, x) {
  console.error('FAIL', m, x ?? '');
  process.exit(1);
}

console.log('=== Isolation fire drill ===');
if (!(await ensureBrivenEngineDatabase()).ok) fail('db');
if (!(await initAuthCoreSdk())) fail('sdk');

const a = `p_iso_a_${Date.now().toString(36)}`;
const b = `p_iso_b_${Date.now().toString(36)}`;
const emailA = `a_${Date.now()}@iso.test`;
const emailB = `b_${Date.now()}@iso.test`;

const ua = await signUpEmailPassword({
  email: emailA,
  password: 'IsoA!9999xx',
  projectId: a,
});
const ub = await signUpEmailPassword({
  email: emailB,
  password: 'IsoB!9999xx',
  projectId: b,
});
if (ua.status !== 'OK' || ub.status !== 'OK') fail('signup', { ua, ub });

const listA = await listBrivenEngineUsers({
  tenantId: projectIdToTenantId(a),
  limit: 50,
});
const listB = await listBrivenEngineUsers({
  tenantId: projectIdToTenantId(b),
  limit: 50,
});

const idsA = new Set(listA.users.map((u) => u.id));
const idsB = new Set(listB.users.map((u) => u.id));
if (idsA.has(ub.user.id)) fail('project A list contains B user');
if (idsB.has(ua.user.id)) fail('project B list contains A user');
if (!idsA.has(ua.user.id)) fail('project A missing own user');
if (!idsB.has(ub.user.id)) fail('project B missing own user');

// Cross-tenant get by id without tenant should still resolve user, but
// tenant-scoped get must miss.
const cross = await getBrivenEngineUser(ua.user.id, {
  tenantId: projectIdToTenantId(b),
});
if (cross) fail('B tenant can read A user by id', cross);

console.log('ok project A users', listA.users.length);
console.log('ok project B users', listB.users.length);
console.log('=== Isolation fire drill PASSED ===');
process.exit(0);

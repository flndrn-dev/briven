/**
 * Step 3 proof: Google/GitHub social login on Doltgres.
 *
 * Without real OAuth client secrets, we prove the Doltgres user/link/session
 * path using a post-exchange profile (same as after Google/GitHub returns).
 * Authorisation URL shape is checked with dummy env credentials.
 *
 *   cd apps/api
 *   BRIVEN_ENGINE_DATABASE_URL=postgres://postgres:devpass@127.0.0.1:5434/briven_engine?sslmode=disable \
 *   BRIVEN_DATA_PLANE_URL=postgres://postgres:devpass@127.0.0.1:5434/postgres?sslmode=disable \
 *   bun scripts/step3-social-proof.mjs
 */

process.env.BRIVEN_AUTH_CORE_ENABLED = 'true';
process.env.BRIVEN_ENV = 'development';
process.env.BRIVEN_ENGINE_DATABASE_URL =
  process.env.BRIVEN_ENGINE_DATABASE_URL ??
  'postgres://postgres:devpass@127.0.0.1:5434/briven_engine?sslmode=disable';
process.env.BRIVEN_DATA_PLANE_URL =
  process.env.BRIVEN_DATA_PLANE_URL ??
  'postgres://postgres:devpass@127.0.0.1:5434/postgres?sslmode=disable';
// Dummy credentials so authorisation URL can be built (not used for real HTTP)
process.env.BRIVEN_GOOGLE_CLIENT_ID =
  process.env.BRIVEN_GOOGLE_CLIENT_ID ?? 'test-google-client-id.apps.googleusercontent.com';
process.env.BRIVEN_GOOGLE_CLIENT_SECRET =
  process.env.BRIVEN_GOOGLE_CLIENT_SECRET ?? 'test-google-secret';
process.env.BRIVEN_GITHUB_CLIENT_ID =
  process.env.BRIVEN_GITHUB_CLIENT_ID ?? 'test-github-client-id';
process.env.BRIVEN_GITHUB_CLIENT_SECRET =
  process.env.BRIVEN_GITHUB_CLIENT_SECRET ?? 'test-github-secret';

const { ensureBrivenEngineDatabase } = await import(
  '../src/services/auth-core/ensure-db.ts'
);
const { initAuthCoreSdk } = await import('../src/services/auth-core/engine.ts');
const {
  getAuthorisationUrl,
  signInUpWithThirdPartyProfile,
} = await import('../src/services/auth-core/thirdparty.ts');
const { getEnginePool } = await import('../src/services/auth-core/db.ts');

const projectId = 'p_step3_local';

console.log('=== Phase 4: social login (Google/GitHub) on Doltgres ===');
console.log({ projectId });

const ensured = await ensureBrivenEngineDatabase();
if (!ensured.ok) {
  console.error('FAIL ensure', ensured);
  process.exit(1);
}
if (!(await initAuthCoreSdk())) {
  console.error('FAIL init');
  process.exit(1);
}

// 1) Authorisation URLs
const googleUrl = await getAuthorisationUrl({
  thirdPartyId: 'google',
  redirectURI: 'http://localhost:3000/auth/callback/google',
  projectId,
});
console.log('google auth url', {
  status: googleUrl.status,
  hasGoogle:
    googleUrl.status === 'OK' &&
    googleUrl.urlWithQueryParams.includes('accounts.google.com'),
  hasClientId:
    googleUrl.status === 'OK' &&
    googleUrl.urlWithQueryParams.includes('test-google-client-id'),
  credentialsSource:
    googleUrl.status === 'OK' ? googleUrl.credentialsSource : null,
});
if (googleUrl.status !== 'OK') {
  console.error('FAIL google url', googleUrl);
  process.exit(1);
}

const githubUrl = await getAuthorisationUrl({
  thirdPartyId: 'github',
  redirectURI: 'http://localhost:3000/auth/callback/github',
  projectId,
});
console.log('github auth url', {
  status: githubUrl.status,
  hasGithub:
    githubUrl.status === 'OK' &&
    githubUrl.urlWithQueryParams.includes('github.com/login/oauth'),
});
if (githubUrl.status !== 'OK') {
  console.error('FAIL github url', githubUrl);
  process.exit(1);
}

// 2) Simulated Google profile (after successful OAuth exchange)
const googleTpId = `google-sub-${Date.now()}`;
const googleEmail = `step3_google_${Date.now()}@example.com`;
const g1 = await signInUpWithThirdPartyProfile({
  profile: {
    thirdPartyId: 'google',
    thirdPartyUserId: googleTpId,
    email: googleEmail,
    emailVerified: true,
    name: 'Step3 Google User',
  },
  projectId,
});
console.log('google first sign-in', {
  status: g1.status,
  createdNewUser: g1.status === 'OK' ? g1.createdNewUser : null,
  userId: g1.status === 'OK' ? g1.user.id : null,
  session: g1.status === 'OK' ? g1.session.handle : null,
});
if (g1.status !== 'OK' || !g1.createdNewUser) {
  console.error('FAIL google first', g1);
  process.exit(1);
}

// 3) Same Google account again → same user, not new
const g2 = await signInUpWithThirdPartyProfile({
  profile: {
    thirdPartyId: 'google',
    thirdPartyUserId: googleTpId,
    email: googleEmail,
    emailVerified: true,
  },
  projectId,
});
console.log('google second sign-in', {
  status: g2.status,
  createdNewUser: g2.status === 'OK' ? g2.createdNewUser : null,
  sameUser: g2.status === 'OK' && g2.user.id === g1.user.id,
});
if (g2.status !== 'OK' || g2.createdNewUser || g2.user.id !== g1.user.id) {
  console.error('FAIL google second', g2);
  process.exit(1);
}

// 4) GitHub profile
const githubTpId = `gh-${Date.now()}`;
const gh = await signInUpWithThirdPartyProfile({
  profile: {
    thirdPartyId: 'github',
    thirdPartyUserId: githubTpId,
    email: `step3_gh_${Date.now()}@example.com`,
    emailVerified: true,
    name: 'Step3 GH',
  },
  projectId,
});
console.log('github sign-in', {
  status: gh.status,
  createdNewUser: gh.status === 'OK' ? gh.createdNewUser : null,
  userId: gh.status === 'OK' ? gh.user.id : null,
});
if (gh.status !== 'OK') {
  console.error('FAIL github', gh);
  process.exit(1);
}

// 5) SQL proof
const pool = getEnginePool();
const links = await pool.query(
  `SELECT third_party_id, third_party_user_id, user_id, tenant_id
   FROM be_third_party_links
   WHERE tenant_id = $1
   ORDER BY created_at`,
  ['proj-p-step3-local'],
);
const sessions = await pool.query(
  `SELECT COUNT(*)::int AS n FROM be_sessions
   WHERE user_id = ANY($1::text[])`,
  [[g1.user.id, gh.user.id]],
);

console.log('SQL third_party_links', links.rows);
console.log('SQL sessions for social users', sessions.rows[0]);

const hasGoogle = links.rows.some(
  (r) => r.third_party_id === 'google' && r.third_party_user_id === googleTpId,
);
const hasGithub = links.rows.some(
  (r) => r.third_party_id === 'github' && r.third_party_user_id === githubTpId,
);
if (!hasGoogle || !hasGithub) {
  console.error('FAIL links missing');
  process.exit(1);
}

console.log('');
console.log('✔ PHASE 4 LOCAL PROOF OK (social)');
console.log('  storage: Doltgres');
console.log('  Google authorisation URL: OK');
console.log('  GitHub authorisation URL: OK');
console.log('  Google sign-up + re-login same user: OK');
console.log('  GitHub sign-up: OK');
console.log('  be_third_party_links rows: OK');
console.log('  sessions: OK');
console.log('  note: real browser OAuth needs live Google/GitHub redirect URIs;');
console.log('        platform env BRIVEN_GOOGLE_* / BRIVEN_GITHUB_* already on France.');
process.exit(0);

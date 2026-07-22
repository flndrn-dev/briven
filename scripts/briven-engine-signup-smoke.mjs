/**
 * Local-only: init supertokens-node against briven-engine and sign up one user.
 * No production deploy. Proves engine + SDK path.
 *
 *   BRIVEN_ENGINE_CONNECTION_URI=http://127.0.0.1:3567 bun scripts/briven-engine-signup-smoke.mjs
 */

import SuperTokens from 'supertokens-node';
import EmailPassword from 'supertokens-node/recipe/emailpassword';
import Session from 'supertokens-node/recipe/session';
import Multitenancy from 'supertokens-node/recipe/multitenancy';

const connectionURI = (
  process.env.BRIVEN_ENGINE_CONNECTION_URI || 'http://127.0.0.1:3567'
).replace(/\/$/, '');

const email = `e2e_${Date.now()}@example.com`;
const password = 'E2eTest!Pass99';
const tenantId = 'proj_p_e2e_local';

console.log('engine', connectionURI);
console.log('tenant', tenantId);
console.log('email', email);

// Probe Core first
const hello = await fetch(`${connectionURI}/hello`);
const helloText = await hello.text();
if (!hello.ok || !/hello/i.test(helloText)) {
  console.error('FAIL core hello', hello.status, helloText);
  process.exit(1);
}
console.log('✔ core hello', helloText.trim());

SuperTokens.init({
  supertokens: { connectionURI },
  appInfo: {
    appName: 'Briven Auth e2e',
    apiDomain: 'http://localhost:3001',
    websiteDomain: 'http://localhost:3000',
    apiBasePath: '/v1/auth-core/fdi',
    websiteBasePath: '/auth',
  },
  recipeList: [
    Session.init(),
    EmailPassword.init(),
    Multitenancy.init(),
  ],
});

// Ensure tenant
try {
  const t = await Multitenancy.createOrUpdateTenant(tenantId, {
    emailPasswordEnabled: true,
  });
  console.log('✔ tenant', t.status, 'createdNew=', t.createdNew);
} catch (err) {
  console.warn('tenant ensure', err instanceof Error ? err.message : err);
}

const signup = await EmailPassword.signUp(tenantId, email, password);
console.log('signup status', signup.status);

if (signup.status !== 'OK') {
  console.error('FAIL signup', signup);
  process.exit(1);
}

console.log('✔ userId', signup.user.id);
console.log('✔ briven-engine local sign-up proof OK');
process.exit(0);

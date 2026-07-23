/**
 * Local proof: SSO connection CRUD + productionReady flag on Doltgres.
 */
import { initAuthCoreSdk, isAuthCoreInitialized } from '../src/services/auth-core/engine.js';
import {
  createEngineSsoConnection,
  deactivateEngineSsoConnection,
  listEngineSsoConnections,
  publicSsoConnection,
} from '../src/services/auth-core/sso.js';

async function main() {
  await initAuthCoreSdk();
  if (!isAuthCoreInitialized()) {
    console.error('FAIL engine not ready');
    process.exit(1);
  }
  const projectId = `p_sso_proof_${Date.now().toString(36)}`;
  const incomplete = await createEngineSsoConnection({
    projectId,
    name: 'draft-oidc',
    providerType: 'oidc',
    config: { issuer: 'https://example.com' },
  });
  console.log('incomplete ready', incomplete.ready, publicSsoConnection(incomplete).productionReady);
  if (incomplete.ready) process.exit(1);

  const ready = await createEngineSsoConnection({
    projectId,
    name: 'okta-ready',
    providerType: 'oidc',
    domains: ['example.com'],
    config: {
      issuer: 'https://dev-example.okta.com',
      clientId: 'client',
      clientSecret: 'secret',
      authorizationUrl: 'https://dev-example.okta.com/oauth2/v1/authorize',
      tokenUrl: 'https://dev-example.okta.com/oauth2/v1/token',
    },
  });
  console.log('ready', ready.ready, publicSsoConnection(ready).productionReady);
  if (!ready.ready) process.exit(1);

  const listed = await listEngineSsoConnections(projectId);
  console.log('listed', listed.length);
  if (listed.length < 2) process.exit(1);

  await deactivateEngineSsoConnection(incomplete.id);
  await deactivateEngineSsoConnection(ready.id);
  console.log('ENTERPRISE_SSO_PROOF_OK', { projectId });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

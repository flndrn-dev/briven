/**
 * Local Phase 6 proof: roles create / list / assign on Doltgres.
 * Usage:
 *   BRIVEN_ENGINE_DATABASE_URL=postgres://... bun apps/api/scripts/phase6-roles-proof.ts
 */
import { initAuthCoreSdk, isAuthCoreInitialized } from '../src/services/auth-core/engine.js';
import {
  assignBrivenEngineRole,
  createBrivenEngineRole,
  getBrivenEngineUserRoles,
  listBrivenEngineRoles,
  userHasPermission,
} from '../src/services/auth-core/roles.js';

const roleName = `phase6_proof_${Date.now().toString(36)}`;
const fakeUserId = `beu_proof_${Date.now().toString(36)}`;

async function main() {
  await initAuthCoreSdk();
  if (!isAuthCoreInitialized()) {
    console.error('FAIL: engine not initialized');
    process.exit(1);
  }

  const created = await createBrivenEngineRole(roleName, ['read', 'write'], {
    tenantId: 'public',
  });
  console.log('create', created);
  if (!created.ok) process.exit(1);

  const listed = await listBrivenEngineRoles({ tenantId: 'public' });
  const found = listed.roles.some((r) => r.name === roleName);
  console.log('list has role', found, 'count', listed.roles.length);
  if (!found) process.exit(1);

  const assigned = await assignBrivenEngineRole(fakeUserId, roleName, {
    tenantId: 'public',
  });
  console.log('assign', assigned);
  if (!assigned.ok) process.exit(1);

  const ur = await getBrivenEngineUserRoles(fakeUserId, { tenantId: 'public' });
  console.log('user roles', ur);
  if (!ur.roles.includes(roleName)) process.exit(1);
  if (!ur.permissions.includes('read')) process.exit(1);

  const ok = await userHasPermission(fakeUserId, 'write', { tenantId: 'public' });
  console.log('has write', ok);
  if (!ok) process.exit(1);

  console.log('PHASE6_ROLES_PROOF_OK', { roleName, fakeUserId });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

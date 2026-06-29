/**
 * Customer auth (Better-Auth) against REAL DoltGres — sprint plan S2.1 + S2.3.
 *
 * The riskiest change in the plan: re-platforming the per-tenant Better-Auth
 * instance off postgres.js + schema-per-project onto pg + database-per-project,
 * with citext replaced by text + a lower(email) unique index. This test PROVES
 * the whole customer-login loop actually works on DoltGres:
 *   provision project DB → create auth tables → sign up → sign in (DIFFERENT
 *   email case) → case-insensitive uniqueness is enforced.
 *
 * Skips when BRIVEN_DATA_PLANE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  closeProjectDbPool,
  dropProjectDatabase,
  provisionProjectDatabase,
  runInProjectDatabase,
} from '../db/data-plane.js';
import { renderAuthProvisioningSql } from './auth-provisioning.js';
import { clearAuthInstancePool, getAuthInstance } from './auth-tenant-pool.js';

const PROJECT_ID = `p_authpool${Date.now().toString(36)}`;
const PASSWORD = 'correct-horse-battery-staple';
const HAS_DB = Boolean(process.env.BRIVEN_DATA_PLANE_URL);

// Acceptance test for the customer-auth rebuild: S2.1a (pg + db-per-project),
// S2.3 (citext→text + lower(email) unique), S2.1b (Better-Auth table schema).
// Skips when no DoltGres is configured.
describe.skipIf(!HAS_DB)('customer auth on real DoltGres (S2.1 + S2.3)', () => {
  beforeAll(async () => {
    await provisionProjectDatabase(PROJECT_ID);
    // Create the auth tables exactly as the "enable auth" route does.
    await runInProjectDatabase(PROJECT_ID, async (tx) => {
      await tx.unsafe('SET dolt_transaction_commit = 1');
      for (const stmt of renderAuthProvisioningSql()) {
        await tx.unsafe(stmt);
      }
    });
  });

  afterAll(async () => {
    await clearAuthInstancePool().catch(() => {});
    await dropProjectDatabase(PROJECT_ID).catch(() => {});
    await closeProjectDbPool(PROJECT_ID).catch(() => {});
  });

  test('sign up, then sign in with a DIFFERENT email case', async () => {
    const inst = await getAuthInstance(PROJECT_ID);

    const signup = await inst.betterAuth.api.signUpEmail({
      body: { email: 'Mixed@Case.com', password: PASSWORD, name: 'Test User' },
    });
    expect(signup).toBeTruthy();
    expect(signup.user?.id).toBeTruthy();

    // Sign in with a different-case email — must resolve to the same account.
    const signin = await inst.betterAuth.api.signInEmail({
      body: { email: 'mixed@case.com', password: PASSWORD },
    });
    expect(signin).toBeTruthy();
    expect(signin.user?.id).toBe(signup.user.id);
  });

  test('case-variant email cannot create a duplicate account', async () => {
    const inst = await getAuthInstance(PROJECT_ID);
    let threw = false;
    try {
      await inst.betterAuth.api.signUpEmail({
        body: { email: 'MIXED@CASE.COM', password: PASSWORD, name: 'Dup' },
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

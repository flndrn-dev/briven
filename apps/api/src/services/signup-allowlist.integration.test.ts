/**
 * Invite-only gate building blocks (control plane).
 *
 * Guards the regression behind Phase 2's invite-only fix: the gate is driven
 * by `isEmailAllowed` + `getOpenSignupsFlag`, which the Better Auth
 * `user.create.before` hook (lib/auth.ts) consults as the SINGLE signup gate
 * (after we set `disableSignUp:false` so the hook actually runs). This test
 * exercises the allowlist service directly + the open/closed gate decision.
 *
 * Integration test (real control Postgres, no mock.module — avoids the
 * process-global mock leak). Gated on BRIVEN_DATA_PLANE_URL — the repo's
 * "integration mode is on" signal — NOT BRIVEN_DATABASE_URL, which
 * test-preload.ts always sets to a dead URL so route tests can construct
 * getDb(). The test:integration run provides both real URLs together.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { signupAllowlist } from '../db/schema.js';
import { addToAllowlist, isEmailAllowed, removeFromAllowlist } from './signup-allowlist.js';

const HAS_DB = Boolean(process.env.BRIVEN_DATA_PLANE_URL);
const SUFFIX = Date.now().toString(36);
const ALLOWED = `allow-${SUFFIX}@example.com`;
const UNKNOWN = `nobody-${SUFFIX}@example.com`;

describe.skipIf(!HAS_DB)('signup allowlist — invite gate building blocks', () => {
  afterAll(async () => {
    const db = getDb();
    await db.delete(signupAllowlist).where(eq(signupAllowlist.email, ALLOWED.toLowerCase()));
  });

  test('unknown email is NOT allowed', async () => {
    expect(await isEmailAllowed(UNKNOWN)).toBe(false);
  });

  test('added email is allowed; lookup is case- + whitespace-insensitive', async () => {
    await addToAllowlist({ email: `${ALLOWED.toUpperCase()} `, invitedBy: null });
    expect(await isEmailAllowed(ALLOWED)).toBe(true);
    expect(await isEmailAllowed(`  ${ALLOWED.toUpperCase()}`)).toBe(true);
  });

  test('duplicate add is rejected (one invite per email)', async () => {
    await expect(addToAllowlist({ email: ALLOWED, invitedBy: null })).rejects.toThrow(
      /already on the allowlist/i,
    );
  });

  test('invalid email is rejected', async () => {
    await expect(addToAllowlist({ email: 'not-an-email', invitedBy: null })).rejects.toThrow(
      /valid email/i,
    );
  });

  test('removeFromAllowlist revokes the invite', async () => {
    expect(await removeFromAllowlist(ALLOWED)).toBe(true);
    expect(await isEmailAllowed(ALLOWED)).toBe(false);
    // removing a non-present email is a no-op, not an error
    expect(await removeFromAllowlist(UNKNOWN)).toBe(false);
  });
});

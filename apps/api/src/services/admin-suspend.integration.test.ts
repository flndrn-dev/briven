/**
 * Account suspension lock-out (Phase 2) — control plane.
 *
 * Guards the Phase-2 fix in services/admin.ts `suspendUser`: before it, a
 * suspended user's brk_* api keys kept full read+write (the api-key path never
 * re-checks owner status), and live sessions stayed valid. `suspendUser` now
 * runs in one transaction that: (1) sets users.suspended_at; (2) deletes EVERY
 * session row for the user (immediate sign-out); (3) cascade-revokes api keys
 * on every project in an org the user SOLELY owns — and ONLY those. A team org
 * the user merely belongs to (not sole owner) must keep its keys live.
 *
 * This proves, against real Postgres:
 *   - the user's suspended_at is stamped;
 *   - all of the user's sessions are gone;
 *   - the key on a SOLE-owned (personal) project is revoked;
 *   - the key on a SHARED (multi-owner team) project SURVIVES — scoping is
 *     identical to what account deletion would erase, no collateral team damage.
 *
 * Integration test (real control Postgres, no mock.module). Gated on
 * BRIVEN_DATA_PLANE_URL — the repo's "integration mode is on" signal — NOT
 * BRIVEN_DATABASE_URL, which test-preload.ts always sets to a dead URL. The
 * test:integration run provides both real URLs together.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { apiKeys, orgMembers, organizations, projects, sessions, users } from '../db/schema.js';
import { suspendUser } from './admin.js';

const HAS_DB = Boolean(process.env.BRIVEN_DATA_PLANE_URL);
const S = Date.now().toString(36);

const SUSPENDEE = `u_susp_${S}`; // the user we suspend
const OTHER = `u_other_${S}`; // owns the shared org alongside nobody else
const PERSONAL_ORG = `o_pers_${S}`; // SUSPENDEE's personal org → sole-owned
const SHARED_ORG = `o_team_${S}`; // OTHER owns it; SUSPENDEE is only a developer
const SOLE_PROJECT = `p_sole_${S}`;
const SHARED_PROJECT = `p_team_${S}`;
const SOLE_KEY = `ak_sole_${S}`; // → revoked
const SHARED_KEY = `ak_team_${S}`; // → survives
const SESSION_A = `s_a_${S}`;
const SESSION_B = `s_b_${S}`;

const USER_IDS = [SUSPENDEE, OTHER];
const ORG_IDS = [PERSONAL_ORG, SHARED_ORG];
const hourFromNow = () => new Date(Date.now() + 60 * 60 * 1000);

describe.skipIf(!HAS_DB)('suspendUser — lock-out + scoped key revocation (Phase 2)', () => {
  beforeAll(async () => {
    const db = getDb();
    await db.insert(users).values([
      { id: SUSPENDEE, email: `${SUSPENDEE}@x.test` },
      { id: OTHER, email: `${OTHER}@x.test` },
    ]);
    await db.insert(organizations).values([
      { id: PERSONAL_ORG, slug: `pers-${S}`, name: 'personal', personal: true, createdBy: SUSPENDEE },
      { id: SHARED_ORG, slug: `team-${S}`, name: 'team', personal: false, createdBy: OTHER },
    ]);
    // suspendUser only inspects orgs the user is a MEMBER of, so seed the
    // membership rows. SUSPENDEE owns the personal org; in the team org OTHER
    // is the sole owner and SUSPENDEE is just a developer.
    await db.insert(orgMembers).values([
      { orgId: PERSONAL_ORG, userId: SUSPENDEE, role: 'owner' },
      { orgId: SHARED_ORG, userId: OTHER, role: 'owner' },
      { orgId: SHARED_ORG, userId: SUSPENDEE, role: 'developer' },
    ]);
    await db.insert(projects).values([
      { id: SOLE_PROJECT, slug: `sole-${S}`, name: 'sole', orgId: PERSONAL_ORG },
      { id: SHARED_PROJECT, slug: `shared-${S}`, name: 'shared', orgId: SHARED_ORG },
    ]);
    await db.insert(apiKeys).values([
      { id: SOLE_KEY, projectId: SOLE_PROJECT, createdBy: SUSPENDEE, name: 'sole', hash: `h_sole_${S}`, suffix: 'aaaa' },
      { id: SHARED_KEY, projectId: SHARED_PROJECT, createdBy: OTHER, name: 'team', hash: `h_team_${S}`, suffix: 'bbbb' },
    ]);
    await db.insert(sessions).values([
      { id: SESSION_A, userId: SUSPENDEE, token: `t_a_${S}`, expiresAt: hourFromNow() },
      { id: SESSION_B, userId: SUSPENDEE, token: `t_b_${S}`, expiresAt: hourFromNow() },
    ]);
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(apiKeys).where(inArray(apiKeys.id, [SOLE_KEY, SHARED_KEY]));
    await db.delete(sessions).where(inArray(sessions.id, [SESSION_A, SESSION_B]));
    await db.delete(projects).where(inArray(projects.id, [SOLE_PROJECT, SHARED_PROJECT]));
    await db.delete(orgMembers).where(inArray(orgMembers.userId, USER_IDS));
    await db.delete(organizations).where(inArray(organizations.id, ORG_IDS));
    await db.delete(users).where(inArray(users.id, USER_IDS));
  });

  test('suspendUser stamps suspended_at and kills every live session', async () => {
    const db = getDb();
    await suspendUser(SUSPENDEE);

    const [row] = await db
      .select({ suspendedAt: users.suspendedAt })
      .from(users)
      .where(eq(users.id, SUSPENDEE));
    expect(row?.suspendedAt).toBeTruthy(); // flag set

    const live = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, SUSPENDEE));
    expect(live.length).toBe(0); // signed out everywhere
  });

  test('a key on a SOLE-owned project is revoked', async () => {
    const db = getDb();
    const [key] = await db
      .select({ revokedAt: apiKeys.revokedAt })
      .from(apiKeys)
      .where(eq(apiKeys.id, SOLE_KEY));
    expect(key?.revokedAt).toBeTruthy(); // dead
  });

  test('a key on a SHARED (team) project survives — no collateral revocation', async () => {
    const db = getDb();
    const [key] = await db
      .select({ revokedAt: apiKeys.revokedAt })
      .from(apiKeys)
      .where(eq(apiKeys.id, SHARED_KEY));
    expect(key?.revokedAt).toBeNull(); // still live
  });
});

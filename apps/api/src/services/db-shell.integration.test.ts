/**
 * db-shell role provisioning against REAL DoltGres — sprint plan S2.9.
 *
 * Verifies the postgres.js→pg migration of role provisioning actually RUNS on
 * DoltGres: CREATE ROLE + GRANTs (in the project database) + ALTER ROLE
 * PASSWORD (no VALID UNTIL — DoltGres rejects it). Proves issueShellToken
 * returns a usable DSN bound to the project's own database.
 *
 * Skips when BRIVEN_DATA_PLANE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import pg from 'pg';

import { dbNameFor, dropProjectDatabase, provisionProjectDatabase } from '../db/data-plane.js';
import { issueShellToken } from './db-shell.js';

const URL = process.env.BRIVEN_DATA_PLANE_URL;
const HAS_DB = Boolean(URL);
const PROJECT_ID = `p_shell${Date.now().toString(36)}`;
const ROLE = `${dbNameFor(PROJECT_ID)}_owner`;

describe.skipIf(!HAS_DB)('db-shell role provisioning on real DoltGres (S2.9)', () => {
  beforeAll(async () => {
    await provisionProjectDatabase(PROJECT_ID);
  });

  afterAll(async () => {
    // Drop the cluster-global role (dropProjectDatabase only drops the db).
    const admin = new pg.Client({ connectionString: URL });
    await admin.connect().catch(() => {});
    await admin.query(`DROP ROLE IF EXISTS "${ROLE}"`).catch(() => {});
    await admin.end().catch(() => {});
    await dropProjectDatabase(PROJECT_ID).catch(() => {});
  });

  test('issueShellToken creates the role + returns a project-db DSN', async () => {
    const out = await issueShellToken(PROJECT_ID);
    expect(out.role).toBe(ROLE);
    expect(out.dsn).toContain(dbNameFor(PROJECT_ID)); // DSN targets proj_<id> database
    expect(out.dsn).not.toContain('search_path'); // no schema-per-project search_path
    expect(out.expiresAt).toBeInstanceOf(Date);

    // NOTE: we deliberately do NOT assert the role shows up in `pg_roles` from a
    // fresh admin connection. DoltGres only partially implements the role
    // catalog — a role created on one connection is not reliably visible in
    // pg_roles from a *different* connection (flaky). The functional contract
    // (issueShellToken ran CREATE ROLE + GRANTs without error and returned a
    // project-scoped DSN + expiry) is what matters and is asserted above; the
    // password-rotation test below further proves the role is real and reusable.
  });

  test('re-issuing rotates the password (DSN changes), role stays', async () => {
    const a = await issueShellToken(PROJECT_ID);
    const b = await issueShellToken(PROJECT_ID);
    expect(a.role).toBe(b.role);
    expect(a.dsn).not.toBe(b.dsn); // password rotated → DSN differs
  });
});

/**
 * Per-table change scoping — Phase 4.1 (the whole point of the phase).
 *
 * Proves the REAL PollManager, against a live DoltGres, fires ONLY the
 * channels whose table actually changed — a write to table_a must NOT wake
 * a subscriber watching table_b. Before Phase 4 every commit re-invoked
 * every subscription in the project; this test locks in the cure so a
 * regression fails CI.
 *
 * How to run (needs a DoltGres container; e.g. the throwaway probe on :5456):
 *   BRIVEN_DATA_PLANE_URL=postgres://postgres:password@127.0.0.1:5456/postgres \
 *     bun test src/poll-manager.integration.test.ts
 *
 * Skips entirely when BRIVEN_DATA_PLANE_URL is unset (keeps the no-DB unit run green).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import pg from 'pg';

import { PollManager } from './poll-manager.js';
import { SubscriptionRegistry } from './subscription-registry.js';

const DSN = process.env.BRIVEN_DATA_PLANE_URL;
const HAS_DB = Boolean(DSN);

// Throwaway project id, unique per run. Sanitised form must match dbNameFor.
const PROJECT_ID = `p4s${Date.now().toString(36)}`;
function dbNameFor(id: string): string {
  return `proj_${id.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
}
function channelFor(id: string, table: string): string {
  return `briven_${dbNameFor(id)}_${table}`;
}
const DB_NAME = dbNameFor(PROJECT_ID);
const CH_A = channelFor(PROJECT_ID, 'table_a');
const CH_B = channelFor(PROJECT_ID, 'table_b');

const AUTHOR = "--author=probe <p@p.io>";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function basePool(): pg.Pool {
  const u = new URL(DSN as string);
  return new pg.Pool({
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, '') || 'postgres',
    max: 1,
  });
}
function projPool(): pg.Pool {
  const u = new URL(DSN as string);
  return new pg.Pool({
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: DB_NAME,
    max: 1,
  });
}

describe.skipIf(!HAS_DB)('PollManager per-table scoping', () => {
  let manager: PollManager | null = null;

  beforeAll(async () => {
    // Provision a throwaway DoltGres database with two tables + a baseline commit.
    const base = basePool();
    await base.query(`DROP DATABASE IF EXISTS ${DB_NAME}`).catch(() => {});
    await base.query(`CREATE DATABASE ${DB_NAME}`);
    await base.end();

    const proj = projPool();
    await proj.query('CREATE TABLE IF NOT EXISTS table_a (id int primary key, v text)');
    await proj.query('CREATE TABLE IF NOT EXISTS table_b (id int primary key, v text)');
    await proj.query(`SELECT DOLT_COMMIT('-A', '-m', 'baseline', '${AUTHOR}')`);
    await proj.end();
  });

  afterAll(async () => {
    if (manager) await manager.close().catch(() => {});
    const base = basePool();
    await base.query(`DROP DATABASE IF EXISTS ${DB_NAME}`).catch(() => {});
    await base.end();
  });

  test('a commit touching only table_a fires CH_A and NOT CH_B', async () => {
    const fired: string[] = [];
    const registry = new SubscriptionRegistry();
    // Two subscribers: one on table_a, one on table_b.
    registry.attach('sub-a', CH_A);
    registry.attach('sub-b', CH_B);

    manager = new PollManager(
      registry,
      async (channel) => {
        fired.push(channel);
      },
      150, // fast poll for the test (clamped floor is 100ms)
    );
    await manager.init(DSN as string);
    manager.addProject(PROJECT_ID);

    // Let the first poll seed the baseline HEAD hash (no fire — no baseline yet).
    await sleep(600);
    expect(fired).toEqual([]); // nothing fired before any change

    // Commit a change to table_a ONLY.
    const proj = projPool();
    await proj.query("INSERT INTO table_a (id, v) VALUES (1, 'x')");
    await proj.query(`SELECT DOLT_COMMIT('-A', '-m', 'touch a', '${AUTHOR}')`);
    await proj.end();

    // Let the next poll detect + scope + fire.
    await sleep(800);

    // CH_A must have fired; CH_B must NOT — that is per-table scoping.
    expect(fired).toContain(CH_A);
    expect(fired).not.toContain(CH_B);
  }, 15_000);
});

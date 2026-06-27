/**
 * DoltGres compatibility alarm — the "smoke alarm" (sprint plan S0.2).
 *
 * Runs against a REAL DoltGres instance and pins exactly which SQL the data
 * plane may and may not use. This is the regression net that stops the
 * "little bugs keep coming back" cycle: every incompatibility is asserted
 * here, so it fails in a test instead of in production / in ISY's face.
 *
 * Two halves:
 *   1. ACCEPTED today  — must keep working (a regression = real breakage).
 *   2. REJECTED today  — documents the constraint the data-plane code works
 *      around. If DoltGres starts SUPPORTING one of these, this test flips
 *      to failing and tells us "you can now delete the workaround".
 *
 * How to run (needs the local DoltGres container up on :5433):
 *   docker compose -f infra/test/docker-compose.dolt.yml up -d   # or the dev container
 *   BRIVEN_DATA_PLANE_URL=postgres://postgres:password@127.0.0.1:5433/postgres \
 *     bun test src/db/dolt-compat.integration.test.ts
 *
 * Without BRIVEN_DATA_PLANE_URL set, the whole suite SKIPS (so the normal
 * no-database unit run stays green).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import pg from 'pg';

const URL = process.env.BRIVEN_DATA_PLANE_URL ?? process.env.DOLT_TEST_URL;
const HAS_DB = Boolean(URL);

// Unique-ish suffix so reruns don't collide (Date.now is fine in a test file).
const TAG = `cmp_${Date.now().toString(36)}`;

let client: pg.Client;

/** Run a statement, return rows. Throws on SQL the engine rejects. */
async function run(sql: string, params?: unknown[]): Promise<pg.QueryResult> {
  return client.query(sql, params as never);
}

/** Assert a statement is ACCEPTED (no throw). */
async function accepts(sql: string, params?: unknown[]): Promise<void> {
  await run(sql, params);
}

/** Assert a statement is REJECTED (throws). Returns the error message. */
async function rejects(sql: string, params?: unknown[]): Promise<string> {
  try {
    await run(sql, params);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error(`Expected DoltGres to REJECT this SQL, but it was accepted:\n${sql}`);
}

describe.skipIf(!HAS_DB)('DoltGres compatibility alarm', () => {
  beforeAll(async () => {
    client = new pg.Client({ connectionString: URL });
    await client.connect();
    await run(`DROP TABLE IF EXISTS "${TAG}"`);
    await run(
      `CREATE TABLE "${TAG}" (id text PRIMARY KEY, name text, score int, created_at timestamp, body jsonb)`,
    );
    await run(`INSERT INTO "${TAG}" (id, name, score) VALUES ('a','Alice',10),('b','Bob',20)`);
  });

  afterAll(async () => {
    if (client) {
      await run(`DROP TABLE IF EXISTS "${TAG}"`).catch(() => {});
      await client.end();
    }
  });

  // ───────────────────────── ACCEPTED today — must keep working ─────────────
  describe('accepted (must keep working)', () => {
    test('ON CONFLICT DO NOTHING — schema-apply / idempotent inserts', async () => {
      await accepts(
        `INSERT INTO "${TAG}" (id, name, score) VALUES ('a','dup',0) ON CONFLICT (id) DO NOTHING`,
      );
    });

    test('jsonb cast + read', async () => {
      await accepts(`UPDATE "${TAG}" SET body = '{"k":1}'::jsonb WHERE id = 'a'`);
      const r = await run(`SELECT body->>'k' AS k FROM "${TAG}" WHERE id = 'a'`);
      expect(r.rows[0].k).toBe('1');
    });

    test('date_trunc + interval', async () => {
      await accepts(`SELECT date_trunc('hour', now() - interval '1 hour') AS h`);
    });

    test('generate_series (dashboard buckets)', async () => {
      const r = await run(`SELECT count(*)::int AS n FROM generate_series(1, 24) g`);
      expect(r.rows[0].n).toBe(24);
    });

    test('COUNT(DISTINCT) + CTE', async () => {
      const r = await run(
        `WITH t AS (SELECT score FROM "${TAG}") SELECT count(DISTINCT score)::int AS n FROM t`,
      );
      expect(r.rows[0].n).toBe(2);
    });

    test('::regclass + pg_total_relation_size (storage usage SQL)', async () => {
      await accepts(`SELECT pg_total_relation_size('"${TAG}"'::regclass) AS bytes`);
    });

    test('gen_random_uuid()', async () => {
      await accepts(`SELECT gen_random_uuid() AS u`);
    });

    test('information_schema 3-way FK join (Studio relations)', async () => {
      await accepts(
        `SELECT tc.constraint_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name
          WHERE tc.constraint_type = 'FOREIGN KEY'`,
      );
    });

    test('DELETE ... RETURNING (guards sprint S1.6 — inline runtime must match isolate)', async () => {
      await run(`INSERT INTO "${TAG}" (id, name) VALUES ('del','tmp')`);
      const r = await run(`DELETE FROM "${TAG}" WHERE id = 'del' RETURNING id`);
      expect(r.rows[0].id).toBe('del');
    });

    test('case-insensitive search via lower()+LIKE (the S1.1 ILIKE replacement)', async () => {
      const r = await run(
        `SELECT id FROM "${TAG}" WHERE lower(name) LIKE '%' || lower($1) || '%' ORDER BY id`,
        ['ALI'],
      );
      expect(r.rows.map((x) => x.id)).toEqual(['a']);
    });

    test('plain TRUNCATE (the S1.3 replacement) on a scratch table', async () => {
      await run(`DROP TABLE IF EXISTS "${TAG}_t"`);
      await run(`CREATE TABLE "${TAG}_t" (id int)`);
      await run(`INSERT INTO "${TAG}_t" VALUES (1)`);
      await accepts(`TRUNCATE "${TAG}_t"`);
      const r = await run(`SELECT count(*)::int AS n FROM "${TAG}_t"`);
      expect(r.rows[0].n).toBe(0);
      await run(`DROP TABLE "${TAG}_t"`);
    });

    test('manual upsert via ON CONFLICT DO NOTHING + UPDATE (the S2.4 replacement)', async () => {
      await run(
        `INSERT INTO "${TAG}" (id, name) VALUES ('a','x') ON CONFLICT (id) DO NOTHING`,
      );
      await run(`UPDATE "${TAG}" SET name = 'AliceUpdated' WHERE id = 'a'`);
      const r = await run(`SELECT name FROM "${TAG}" WHERE id = 'a'`);
      expect(r.rows[0].name).toBe('AliceUpdated');
    });

    test('expanded keyset cursor a<$1 OR (a=$1 AND b<$2) (the S2.5 replacement)', async () => {
      await accepts(
        `SELECT id FROM "${TAG}" WHERE (score < $1 OR (score = $1 AND id < $2)) ORDER BY score DESC, id DESC`,
        [20, 'b'],
      );
    });
  });

  // ───────────────────── REJECTED today — workaround required ───────────────
  // If one of these starts PASSING, the test fails on purpose → delete the
  // matching workaround and update BRIVEN-BUGS-REPORT.md.
  describe('rejected (workaround required — flip = good news)', () => {
    test('ILIKE → unsupported (drives S1.1)', async () => {
      const msg = await rejects(`SELECT id FROM "${TAG}" WHERE name ILIKE '%ali%'`);
      expect(msg.toLowerCase()).toContain('ilike');
    });

    test('SET LOCAL → unsupported (drives S1.2)', async () => {
      await rejects(`SET LOCAL statement_timeout = '5s'`);
    });

    test('TRUNCATE ... RESTART IDENTITY → syntax error (drives S1.3)', async () => {
      await run(`DROP TABLE IF EXISTS "${TAG}_r"`);
      await run(`CREATE TABLE "${TAG}_r" (id int)`);
      await rejects(`TRUNCATE "${TAG}_r" RESTART IDENTITY`);
      await run(`DROP TABLE "${TAG}_r"`);
    });

    test('ON CONFLICT DO UPDATE (excluded) → unsupported (drives S2.4)', async () => {
      await rejects(
        `INSERT INTO "${TAG}" (id, name) VALUES ('a','z') ON CONFLICT (id) DO UPDATE SET name = excluded.name`,
      );
    });

    test('row-tuple comparison (a,b) < ($1,$2) → unsupported (drives S2.5)', async () => {
      await rejects(`SELECT id FROM "${TAG}" WHERE (score, id) < ($1, $2)`, [20, 'b']);
    });

    test('citext type → does not exist (drives S2.3)', async () => {
      await rejects(`CREATE TABLE "${TAG}_c" (email citext)`);
    });

    test('CREATE EXTENSION → unsupported (drives S2.3)', async () => {
      await rejects(`CREATE EXTENSION IF NOT EXISTS citext`);
    });

    test('vector(N) column → syntax error (drives S1.5 gate)', async () => {
      await rejects(`CREATE TABLE "${TAG}_v" (embedding vector(3))`);
    });
  });
});

import { brivenError, ValidationError } from '@briven/shared';

import { dataPlaneClient, schemaNameFor } from '../db/data-plane.js';

import { listProjectTables } from './studio.js';

/**
 * Snapshots — the non-coder "undo button" on Postgres (the lite stand-in for
 * Dolt's git-for-data until Dolt is production-ready). A snapshot is a
 * point-in-time COPY of every user table in a project's schema, kept in a
 * dedicated `snap_<id>` schema in the same data-plane database. Restore swaps
 * the live data back to the snapshot's.
 *
 * Pure SQL via the (superuser) data-plane client — no shell, no extra infra.
 * Registry lives in a platform-owned `_briven_snapshots` table inside the
 * project schema (same `_briven_` reserved prefix as migrations/meta).
 */

const SNAP_ID_RE = /^s[0-9a-f]{24}$/;

function newSnapId(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return 's' + Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface SnapshotSummary {
  readonly id: string;
  readonly name: string;
  readonly tableCount: number;
  readonly createdAt: string;
}

/** Lazily create the per-project snapshot registry table. */
async function ensureRegistry(sql: ReturnType<typeof dataPlaneClient>, schema: string): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "${schema}"."_briven_snapshots" (
      id text PRIMARY KEY,
      name text NOT NULL,
      snap_schema text NOT NULL,
      table_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

/**
 * Take a snapshot of every user table in the project. Copies each table's
 * structure + rows into a fresh `snap_<id>` schema. Foreign keys are NOT
 * copied by `LIKE`, so the snapshot tables are independent data holders.
 */
export async function createSnapshot(projectId: string, name: string): Promise<SnapshotSummary> {
  const cleanName = (name ?? '').trim().slice(0, 80) || 'snapshot';
  const schema = schemaNameFor(projectId);
  const sql = dataPlaneClient();
  await ensureRegistry(sql, schema);

  const tables = await listProjectTables(projectId);
  const snapId = newSnapId();
  const snap = `snap_${snapId}`;

  await sql.unsafe(`CREATE SCHEMA "${snap}"`);
  for (const t of tables) {
    await sql.unsafe(`CREATE TABLE "${snap}"."${t.name}" (LIKE "${schema}"."${t.name}")`);
    await sql.unsafe(`INSERT INTO "${snap}"."${t.name}" SELECT * FROM "${schema}"."${t.name}"`);
  }

  const createdAt = new Date().toISOString();
  await sql.unsafe(
    `INSERT INTO "${schema}"."_briven_snapshots" (id, name, snap_schema, table_count, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [snapId, cleanName, snap, tables.length, createdAt],
  );

  return { id: snapId, name: cleanName, tableCount: tables.length, createdAt };
}

/** List a project's snapshots, newest first. */
export async function listSnapshots(projectId: string): Promise<SnapshotSummary[]> {
  const schema = schemaNameFor(projectId);
  const sql = dataPlaneClient();
  await ensureRegistry(sql, schema);
  const rows = (await sql.unsafe(
    `SELECT id, name, table_count, created_at
     FROM "${schema}"."_briven_snapshots" ORDER BY created_at DESC`,
  )) as Array<{ id: string; name: string; table_count: number | string; created_at: Date | string }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    tableCount: Number(r.table_count) || 0,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

/**
 * Restore the project's data to a snapshot. For every table captured in the
 * snapshot that still exists live, TRUNCATE + re-INSERT from the snapshot.
 * Runs in one transaction with FK/trigger checks disabled (superuser) so
 * table order doesn't matter and the restore is atomic.
 */
export async function restoreSnapshot(
  projectId: string,
  snapId: string,
): Promise<{ restored: number }> {
  if (!SNAP_ID_RE.test(snapId)) {
    throw new ValidationError('invalid snapshot id', { snapId });
  }
  const schema = schemaNameFor(projectId);
  const sql = dataPlaneClient();

  const meta = (await sql.unsafe(
    `SELECT snap_schema FROM "${schema}"."_briven_snapshots" WHERE id = $1`,
    [snapId],
  )) as Array<{ snap_schema: string }>;
  if (!meta[0]) {
    throw new brivenError('not_found', `snapshot not found: ${snapId}`, { status: 404 });
  }
  const snap = meta[0].snap_schema;

  const snapTables = (await sql.unsafe(
    `SELECT c.relname AS name FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind = 'r'`,
    [snap],
  )) as Array<{ name: string }>;

  let restored = 0;
  await sql.begin(async (tx) => {
    // Disable FK/trigger enforcement for a clean, order-independent restore.
    await tx.unsafe(`SET LOCAL session_replication_role = replica`);
    for (const t of snapTables) {
      const live = (await tx.unsafe(
        `SELECT 1 AS ok FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'r'`,
        [schema, t.name],
      )) as Array<{ ok: number }>;
      if (!live[0]) continue; // table was dropped since the snapshot — skip
      await tx.unsafe(`TRUNCATE "${schema}"."${t.name}"`);
      await tx.unsafe(`INSERT INTO "${schema}"."${t.name}" SELECT * FROM "${snap}"."${t.name}"`);
      restored++;
    }
  });

  return { restored };
}

/** Delete a snapshot (drops its schema + registry row). */
export async function deleteSnapshot(projectId: string, snapId: string): Promise<void> {
  if (!SNAP_ID_RE.test(snapId)) {
    throw new ValidationError('invalid snapshot id', { snapId });
  }
  const schema = schemaNameFor(projectId);
  const sql = dataPlaneClient();
  const meta = (await sql.unsafe(
    `SELECT snap_schema FROM "${schema}"."_briven_snapshots" WHERE id = $1`,
    [snapId],
  )) as Array<{ snap_schema: string }>;
  if (!meta[0]) return;
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${meta[0].snap_schema}" CASCADE`);
  await sql.unsafe(`DELETE FROM "${schema}"."_briven_snapshots" WHERE id = $1`, [snapId]);
}

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

export const SNAP_ID_RE = /^s[0-9a-f]{24}$/;

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
  /**
   * True for snapshots taken automatically by the scheduled auto-snapshot
   * worker; false for ones a person saved by hand. Only `auto` snapshots
   * are ever pruned by retention — manual ones are kept until deleted.
   */
  readonly auto: boolean;
}

/**
 * Lazily create (and forward-migrate) the per-project snapshot registry
 * table. The `auto` column distinguishes worker-created save-points from
 * manual ones; it's added idempotently so registries created before the
 * auto-snapshot feature gain it on first touch.
 */
async function ensureRegistry(sql: ReturnType<typeof dataPlaneClient>, schema: string): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "${schema}"."_briven_snapshots" (
      id text PRIMARY KEY,
      name text NOT NULL,
      snap_schema text NOT NULL,
      table_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      auto boolean NOT NULL DEFAULT false
    )
  `);
  // Forward-migrate registries created before the `auto` column existed.
  await sql.unsafe(`
    ALTER TABLE "${schema}"."_briven_snapshots"
      ADD COLUMN IF NOT EXISTS auto boolean NOT NULL DEFAULT false
  `);
}

/**
 * Take a snapshot of every user table in the project. Copies each table's
 * structure + rows into a fresh `snap_<id>` schema. Foreign keys are NOT
 * copied by `LIKE`, so the snapshot tables are independent data holders.
 */
export async function createSnapshot(
  projectId: string,
  name: string,
  options: { auto?: boolean } = {},
): Promise<SnapshotSummary> {
  const auto = options.auto ?? false;
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
    `INSERT INTO "${schema}"."_briven_snapshots" (id, name, snap_schema, table_count, created_at, auto)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [snapId, cleanName, snap, tables.length, createdAt, auto],
  );

  return { id: snapId, name: cleanName, tableCount: tables.length, createdAt, auto };
}

/** List a project's snapshots, newest first. */
export async function listSnapshots(projectId: string): Promise<SnapshotSummary[]> {
  const schema = schemaNameFor(projectId);
  const sql = dataPlaneClient();
  await ensureRegistry(sql, schema);
  const rows = (await sql.unsafe(
    `SELECT id, name, table_count, created_at, auto
     FROM "${schema}"."_briven_snapshots" ORDER BY created_at DESC`,
  )) as Array<{
    id: string;
    name: string;
    table_count: number | string;
    created_at: Date | string;
    auto: boolean;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    tableCount: Number(r.table_count) || 0,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    auto: r.auto === true,
  }));
}

/**
 * Prune automatic snapshots beyond a retention count, oldest first. Only
 * rows with `auto = true` are ever considered — manual snapshots are never
 * counted or deleted. Returns the ids of the snapshots that were pruned.
 *
 * Idempotent: when there are <= keepCount auto snapshots this is a no-op.
 * Deletion reuses deleteSnapshot, so each pruned snapshot's schema is
 * dropped and its registry row removed in the same way a manual delete
 * would do it.
 */
export async function pruneAutoSnapshots(
  projectId: string,
  keepCount: number,
): Promise<{ pruned: string[] }> {
  const keep = Math.max(0, Math.floor(keepCount));
  const schema = schemaNameFor(projectId);
  const sql = dataPlaneClient();
  await ensureRegistry(sql, schema);

  // Auto snapshots, newest first. We keep the first `keep` and drop the rest.
  const rows = (await sql.unsafe(
    `SELECT id FROM "${schema}"."_briven_snapshots"
      WHERE auto = true
      ORDER BY created_at DESC`,
  )) as Array<{ id: string }>;

  const doomed = rows.slice(keep).map((r) => r.id);
  for (const id of doomed) {
    await deleteSnapshot(projectId, id);
  }
  return { pruned: doomed };
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

/**
 * Maximum rows examined per table when diffing. Snapshots can hold large
 * tables; we never stream unbounded data into a diff response. Both the live
 * and snapshot side are read in PK order and capped at this many rows. When a
 * table has more than this on either side, the table's row diff is marked
 * `truncated` so the UI can say "showing the first N rows".
 */
const DIFF_ROW_CAP = 1000;

/** A column present on one side of the diff but not the other. */
export interface ColumnDiff {
  readonly name: string;
  readonly dataType: string;
}

export interface TableRowDiff {
  /** Rows present live but not in the snapshot (matched by PK). */
  readonly added: number;
  /** Rows present in the snapshot but not live (matched by PK). */
  readonly removed: number;
  /** Rows present on both sides whose non-PK contents differ. */
  readonly changed: number;
  /** Row count on the live side (capped sample size, see `truncated`). */
  readonly liveRowCount: number;
  /** Row count on the snapshot side (capped sample size, see `truncated`). */
  readonly snapshotRowCount: number;
  /** True when either side exceeded DIFF_ROW_CAP and the diff is partial. */
  readonly truncated: boolean;
}

/** Per-table diff entry: schema delta + (optional) row delta. */
export interface TableDiff {
  readonly name: string;
  /** Columns present live but absent from the snapshot copy. */
  readonly columnsAdded: readonly ColumnDiff[];
  /** Columns present in the snapshot copy but absent live. */
  readonly columnsRemoved: readonly ColumnDiff[];
  /**
   * Row-level delta. Null when the table has no primary key (we can't match
   * rows reliably without one) — `noPrimaryKey` is then true.
   */
  readonly rows: TableRowDiff | null;
  /** True when row diffing was skipped because the table has no primary key. */
  readonly noPrimaryKey: boolean;
}

export interface SnapshotDiff {
  readonly snapshotId: string;
  readonly snapshotName: string;
  readonly snapshotCreatedAt: string;
  /** Tables that exist live now but were not in the snapshot. */
  readonly tablesAdded: readonly string[];
  /** Tables captured in the snapshot but since dropped live. */
  readonly tablesRemoved: readonly string[];
  /** Per-table diffs for tables present on BOTH sides. */
  readonly tables: readonly TableDiff[];
  /** The per-table row examination cap (so the UI can phrase truncation). */
  readonly rowCap: number;
}

type ColRow = { column_name: string; data_type: string; is_pk: boolean };

/** Read columns + PK membership for one table in one schema. Read-only. */
async function readColumns(
  sql: ReturnType<typeof dataPlaneClient>,
  schema: string,
  table: string,
): Promise<ColRow[]> {
  return (await sql.unsafe(
    `
    WITH pk_cols AS (
      SELECT a.attname AS column_name
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
      WHERE i.indisprimary AND n.nspname = $1 AND c.relname = $2
    )
    SELECT
      c.column_name,
      c.data_type,
      (pk.column_name IS NOT NULL) AS is_pk
    FROM information_schema.columns c
    LEFT JOIN pk_cols pk ON pk.column_name = c.column_name
    WHERE c.table_schema = $1 AND c.table_name = $2
    ORDER BY c.ordinal_position
  `,
    [schema, table],
  )) as ColRow[];
}

/**
 * Compute the row-level delta for one table present on both sides, matched by
 * primary key. Reads at most DIFF_ROW_CAP rows per side (ordered by PK) and
 * compares the full row JSON for "changed". Pure read — never writes. The
 * `pkCols` are validated identifiers (real column names from the catalog), so
 * interpolating them is safe; the schema/table names are likewise catalog-
 * sourced. Everything else is structural SQL with no user values.
 */
async function diffRows(
  sql: ReturnType<typeof dataPlaneClient>,
  liveSchema: string,
  snapSchema: string,
  table: string,
  pkCols: readonly string[],
): Promise<TableRowDiff> {
  const orderBy = pkCols.map((c) => `"${c}"`).join(', ');
  const keyExpr = pkCols.map((c) => `"${c}"::text`).join(` || '' || `);

  // Pull a capped, PK-ordered sample from each side. We read the whole row as
  // JSON so we can detect content changes without enumerating every column,
  // and a separate stable key built from the PK columns for matching.
  const read = async (schema: string) =>
    (await sql.unsafe(
      `SELECT (${keyExpr}) AS _k, to_jsonb(t.*) AS _row
         FROM "${schema}"."${table}" t
        ORDER BY ${orderBy}
        LIMIT ${DIFF_ROW_CAP + 1}`,
    )) as Array<{ _k: string; _row: Record<string, unknown> }>;

  const liveRaw = await read(liveSchema);
  const snapRaw = await read(snapSchema);
  const truncated = liveRaw.length > DIFF_ROW_CAP || snapRaw.length > DIFF_ROW_CAP;
  const live = truncated ? liveRaw.slice(0, DIFF_ROW_CAP) : liveRaw;
  const snap = truncated ? snapRaw.slice(0, DIFF_ROW_CAP) : snapRaw;

  const snapByKey = new Map(snap.map((r) => [r._k, r._row]));
  const liveKeys = new Set(live.map((r) => r._k));

  let added = 0;
  let changed = 0;
  for (const r of live) {
    const prior = snapByKey.get(r._k);
    if (prior === undefined) {
      added++;
    } else if (JSON.stringify(prior) !== JSON.stringify(r._row)) {
      changed++;
    }
  }
  let removed = 0;
  for (const r of snap) {
    if (!liveKeys.has(r._k)) removed++;
  }

  return {
    added,
    removed,
    changed,
    liveRowCount: live.length,
    snapshotRowCount: snap.length,
    truncated,
  };
}

/**
 * Compare the CURRENT project schema (`proj_<id>`) against a snapshot schema
 * (`snap_<id>`) and return a structured, capped diff: tables added/removed,
 * per-table columns added/removed, and per-table row delta matched by primary
 * key. Strictly read-only — never writes to either schema. Row examination is
 * capped at DIFF_ROW_CAP per table per side; tables without a primary key get
 * `noPrimaryKey: true` and no row delta (we can't match rows safely).
 */
export async function diffSnapshot(projectId: string, snapId: string): Promise<SnapshotDiff> {
  if (!SNAP_ID_RE.test(snapId)) {
    throw new ValidationError('invalid snapshot id', { snapId });
  }
  const schema = schemaNameFor(projectId);
  const sql = dataPlaneClient();
  await ensureRegistry(sql, schema);

  const meta = (await sql.unsafe(
    `SELECT name, snap_schema, created_at FROM "${schema}"."_briven_snapshots" WHERE id = $1`,
    [snapId],
  )) as Array<{ name: string; snap_schema: string; created_at: Date | string }>;
  if (!meta[0]) {
    throw new brivenError('not_found', `snapshot not found: ${snapId}`, { status: 404 });
  }
  const snap = meta[0].snap_schema;
  const snapshotCreatedAt =
    meta[0].created_at instanceof Date
      ? meta[0].created_at.toISOString()
      : String(meta[0].created_at);

  // User tables on each side (skip platform-owned `_briven_*`). The snapshot
  // schema only ever holds copies of user tables, but we filter both for
  // symmetry and safety.
  const tablesIn = async (s: string) =>
    (
      (await sql.unsafe(
        `SELECT c.relname AS name FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relkind = 'r'
            AND c.relname NOT LIKE '\\_briven\\_%' ESCAPE '\\'
          ORDER BY c.relname`,
        [s],
      )) as Array<{ name: string }>
    ).map((r) => r.name);

  const liveTables = await tablesIn(schema);
  const snapTables = await tablesIn(snap);
  const liveSet = new Set(liveTables);
  const snapSet = new Set(snapTables);

  const tablesAdded = liveTables.filter((t) => !snapSet.has(t));
  const tablesRemoved = snapTables.filter((t) => !liveSet.has(t));
  const common = liveTables.filter((t) => snapSet.has(t));

  const tables: TableDiff[] = [];
  for (const table of common) {
    const liveCols = await readColumns(sql, schema, table);
    const snapCols = await readColumns(sql, snap, table);
    const liveColSet = new Set(liveCols.map((c) => c.column_name));
    const snapColSet = new Set(snapCols.map((c) => c.column_name));

    const columnsAdded: ColumnDiff[] = liveCols
      .filter((c) => !snapColSet.has(c.column_name))
      .map((c) => ({ name: c.column_name, dataType: c.data_type }));
    const columnsRemoved: ColumnDiff[] = snapCols
      .filter((c) => !liveColSet.has(c.column_name))
      .map((c) => ({ name: c.column_name, dataType: c.data_type }));

    // Match rows by the LIVE table's PK. If the live PK columns aren't all
    // present in the snapshot copy (rare — schema changed), we can't match
    // rows reliably, so treat it as "no primary key" for the row diff.
    const pkCols = liveCols.filter((c) => c.is_pk).map((c) => c.column_name);
    const pkUsable = pkCols.length > 0 && pkCols.every((c) => snapColSet.has(c));

    const rows = pkUsable ? await diffRows(sql, schema, snap, table, pkCols) : null;
    tables.push({
      name: table,
      columnsAdded,
      columnsRemoved,
      rows,
      noPrimaryKey: !pkUsable,
    });
  }

  return {
    snapshotId: snapId,
    snapshotName: meta[0].name,
    snapshotCreatedAt,
    tablesAdded,
    tablesRemoved,
    tables,
    rowCap: DIFF_ROW_CAP,
  };
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

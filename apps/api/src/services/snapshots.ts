import { brivenError, ValidationError } from '@briven/shared';
import pg from 'pg';

import { dbNameFor } from '../db/data-plane.js';
import { env } from '../env.js';
import { log } from '../lib/logger.js';

/**
 * Snapshots — the non-coder "undo button", now built on DoltGres-native
 * version control instead of the old schema-clone hack.
 *
 * Each project is its own DoltGres DATABASE (`proj_<id>`) with an independent
 * commit history. A snapshot is a **Dolt tag** — a stable, named pointer at a
 * commit — created over a `DOLT_COMMIT` of the project's current state:
 *
 *   - create  → ensure a commit of the working set, then `DOLT_TAG` it.
 *   - list    → read `dolt_tags` (one row per snapshot).
 *   - restore → `DOLT_RESET('--hard', tag)` rolls the working data back to the
 *               snapshot. Tags survive resets, so restoring to a *different*
 *               snapshot afterwards ("undo of the undo") always works.
 *   - diff    → `DOLT_DIFF_SUMMARY` / `DOLT_DIFF` between the snapshot and the
 *               current (WORKING) data.
 *   - delete  → `DOLT_TAG('-d', tag)`.
 *
 * Why tags and not a registry table: a `_briven_snapshots` table would itself
 * be versioned data inside the project's branch, so `DOLT_RESET('--hard', …)`
 * would roll the registry back too and lose snapshot rows. `dolt_tags` is Dolt
 * system metadata — it is NOT affected by a hard reset (verified against the
 * live DoltGres build) — so all snapshot bookkeeping lives there. Per-snapshot
 * metadata (the human label, the auto/manual flag, the table count) is stored
 * as a small JSON blob in the tag's message.
 *
 * Connection model: DOLT_* procedures are run in autocommit on a dedicated
 * per-project `pg` pool (NOT `runInProjectDatabase`, which wraps everything in
 * one BEGIN/COMMIT). The reason is `DOLT_COMMIT` raises "nothing to commit"
 * when the working set is clean; in Postgres a raised statement aborts the
 * whole surrounding transaction, so we must pre-check `dolt_status` and run
 * each procedure as its own implicitly-committed statement. The `pg` driver is
 * required here (postgres.js desyncs against DoltGres — see ADR 0001).
 */

export const SNAP_ID_RE = /^s[0-9a-f]{24}$/;

function newSnapId(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return 's' + Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Per-snapshot metadata we encode into the Dolt tag message as JSON. */
interface TagMeta {
  /** Human label. */
  readonly l: string;
  /** Auto (worker-created) vs manual. */
  readonly a: boolean;
  /** User-table count captured at create time. */
  readonly t: number;
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
  /** The Dolt commit hash this snapshot's tag points at. */
  readonly commitHash: string;
}

// ---------------------------------------------------------------------------
// Per-project DoltGres connection (autocommit) — see file header for why this
// is a dedicated pool rather than runInProjectDatabase.
// ---------------------------------------------------------------------------

const _pools = new Map<string, pg.Pool>();

function poolForDb(dbName: string): pg.Pool {
  const url = env.BRIVEN_DATA_PLANE_URL;
  if (!url) {
    throw new Error('BRIVEN_DATA_PLANE_URL is not configured');
  }
  let pool = _pools.get(dbName);
  if (!pool) {
    const base = new URL(url);
    pool = new pg.Pool({
      host: base.hostname,
      port: Number(base.port || 5432),
      user: decodeURIComponent(base.username),
      password: decodeURIComponent(base.password),
      database: dbName,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    _pools.set(dbName, pool);
    log.info('snapshot_db_pool_opened', { dbName });
  }
  return pool;
}

/** Run one autocommit statement against a project's DoltGres database. */
async function q(
  dbName: string,
  text: string,
  params?: readonly unknown[],
): Promise<Record<string, unknown>[]> {
  const pool = poolForDb(dbName);
  const res = await pool.query(text, params ? [...params] : undefined);
  return res.rows as Record<string, unknown>[];
}

/** Close every cached snapshot pool (call on shutdown if wired). */
export async function closeSnapshotPools(): Promise<void> {
  const pools = Array.from(_pools.values());
  _pools.clear();
  await Promise.all(pools.map((p) => p.end()));
}

/** The first column value of the first row (DOLT_* funcs return one scalar). */
function scalar(rows: Record<string, unknown>[]): string {
  const row = rows[0];
  if (!row) return '';
  const v = Object.values(row)[0];
  return v == null ? '' : String(v);
}

/** Some DOLT_* funcs wrap their result like `{hash}`; strip the braces. */
function unwrap(v: string): string {
  return v.startsWith('{') && v.endsWith('}') ? v.slice(1, -1) : v;
}

/** Count the project's user tables (public schema, excluding `_briven_*`). */
async function countUserTables(dbName: string): Promise<number> {
  const rows = await q(
    dbName,
    `SELECT count(*)::int AS n
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND left(table_name, 8) <> '_briven_'`,
  );
  return Number(rows[0]?.n) || 0;
}

/** True when the working set has uncommitted changes (`dolt_status` rows). */
async function isDirty(dbName: string): Promise<boolean> {
  const rows = await q(dbName, `SELECT count(*)::int AS n FROM dolt_status`);
  return (Number(rows[0]?.n) || 0) > 0;
}

function parseMeta(message: string, fallbackLabel: string): TagMeta {
  try {
    const m = JSON.parse(message) as Partial<TagMeta>;
    if (m && typeof m === 'object') {
      return {
        l: typeof m.l === 'string' ? m.l : fallbackLabel,
        a: m.a === true,
        t: Number(m.t) || 0,
      };
    }
  } catch {
    // Not our JSON (e.g. a hand-made tag) — fall through to defaults.
  }
  return { l: fallbackLabel, a: false, t: 0 };
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  // DoltGres returns tag dates as 'YYYY-MM-DD HH:MM:SS.mmm' (UTC).
  const s = String(v ?? '');
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

/**
 * Take a snapshot of the project's current data: commit the working set (if
 * dirty), then create a Dolt tag pointing at HEAD. The tag name is the
 * snapshot id (`s` + 24 hex, matching SNAP_ID_RE); the label/auto/tableCount
 * are stored in the tag's message.
 */
export async function createSnapshot(
  projectId: string,
  name: string,
  options: { auto?: boolean } = {},
): Promise<SnapshotSummary> {
  const auto = options.auto ?? false;
  const cleanName = (name ?? '').trim().slice(0, 80) || 'snapshot';
  const dbName = dbNameFor(projectId);

  const tableCount = await countUserTables(dbName);

  // Only commit when there is something to commit — DOLT_COMMIT raises
  // "nothing to commit" on a clean working set, which would otherwise surface
  // as an error to the caller.
  if (await isDirty(dbName)) {
    await q(dbName, `SELECT DOLT_COMMIT('-A', '-m', $1)`, [`snapshot: ${cleanName}`]);
  }

  const commitHash = unwrap(scalar(await q(dbName, `SELECT DOLT_HASHOF('HEAD')`)));

  const snapId = newSnapId();
  const meta: TagMeta = { l: cleanName, a: auto, t: tableCount };
  await q(dbName, `SELECT DOLT_TAG($1, '-m', $2, 'HEAD')`, [snapId, JSON.stringify(meta)]);

  return {
    id: snapId,
    name: cleanName,
    tableCount,
    createdAt: new Date().toISOString(),
    auto,
    commitHash,
  };
}

/** Read a project's snapshot tags (our `s…` ids only), newest first. */
async function readSnapshotTags(dbName: string): Promise<SnapshotSummary[]> {
  const rows = await q(
    dbName,
    `SELECT tag_name, tag_hash, message, date FROM dolt_tags ORDER BY date DESC`,
  );
  const out: SnapshotSummary[] = [];
  for (const r of rows) {
    const id = String(r.tag_name ?? '');
    if (!SNAP_ID_RE.test(id)) continue; // ignore non-snapshot tags
    const meta = parseMeta(String(r.message ?? ''), id);
    out.push({
      id,
      name: meta.l,
      tableCount: meta.t,
      createdAt: toIso(r.date),
      auto: meta.a,
      commitHash: String(r.tag_hash ?? ''),
    });
  }
  return out;
}

/** List a project's snapshots, newest first. */
export async function listSnapshots(projectId: string): Promise<SnapshotSummary[]> {
  return readSnapshotTags(dbNameFor(projectId));
}

/** A snapshot row tagged with the project (database) it belongs to. */
export interface CrossProjectSnapshot extends SnapshotSummary {
  /** The data-plane database (`proj_<id>`) the snapshot was found in. */
  readonly schema: string;
}

/**
 * Open an admin connection to the data plane's default database so we can
 * enumerate `proj_*` databases. Reuses the per-db pool cache keyed by the
 * URL's own database name.
 */
function adminDbName(): string {
  const url = env.BRIVEN_DATA_PLANE_URL;
  if (!url) throw new Error('BRIVEN_DATA_PLANE_URL is not configured');
  const path = new URL(url).pathname.replace(/^\//, '');
  return path || 'postgres';
}

/**
 * Operator-facing read of recent snapshots ACROSS every project, newest
 * first. Under database-per-project each project keeps its own `dolt_tags`,
 * so this enumerates the `proj_*` databases (one catalog read) then reads
 * each project's snapshot tags. Per-database failures are skipped so one bad
 * project can't sink the whole list. When the data plane isn't configured
 * (local dev), returns an empty list rather than throwing.
 */
export async function listRecentSnapshotsAcrossProjects(
  limit = 200,
): Promise<CrossProjectSnapshot[]> {
  const cap = Math.min(Math.max(limit, 1), 1000);
  if (!env.BRIVEN_DATA_PLANE_URL) return [];

  let dbRows: Record<string, unknown>[];
  try {
    dbRows = await q(
      adminDbName(),
      `SELECT datname FROM pg_database WHERE left(datname, 5) = 'proj_' ORDER BY datname`,
    );
  } catch (err) {
    log.warn('snapshot_cross_project_enumerate_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const all: CrossProjectSnapshot[] = [];
  for (const row of dbRows) {
    const dbName = String(row.datname ?? '');
    if (!dbName) continue;
    try {
      const snaps = await readSnapshotTags(dbName);
      for (const s of snaps) all.push({ ...s, schema: dbName });
    } catch (err) {
      // Skip projects whose DB can't be read (e.g. mid-teardown).
      log.warn('snapshot_cross_project_read_failed', {
        dbName,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return all.slice(0, cap);
}

/**
 * Prune automatic snapshots beyond a retention count, oldest first. Only
 * snapshots flagged `auto` are ever considered — manual ones are never
 * counted or deleted. Returns the ids of the snapshots that were pruned.
 */
export async function pruneAutoSnapshots(
  projectId: string,
  keepCount: number,
): Promise<{ pruned: string[] }> {
  const keep = Math.max(0, Math.floor(keepCount));
  const dbName = dbNameFor(projectId);
  const snaps = (await readSnapshotTags(dbName)).filter((s) => s.auto);
  // readSnapshotTags is newest-first; keep the first `keep`, drop the rest.
  const doomed = snaps.slice(keep).map((s) => s.id);
  for (const id of doomed) {
    await q(dbName, `SELECT DOLT_TAG('-d', $1)`, [id]);
  }
  return { pruned: doomed };
}

/**
 * Restore the project's data to a snapshot via `DOLT_RESET('--hard', tag)`.
 * Because every write to the project auto-commits, the next change after a
 * restore commits forward from here; and since the snapshot tags themselves
 * survive the reset, restoring to a different snapshot afterwards ("undo of
 * the undo") always works. Returns the user-table count after the restore.
 */
export async function restoreSnapshot(
  projectId: string,
  snapId: string,
): Promise<{ restored: number }> {
  if (!SNAP_ID_RE.test(snapId)) {
    throw new ValidationError('invalid snapshot id', { snapId });
  }
  const dbName = dbNameFor(projectId);

  const exists = await q(dbName, `SELECT 1 AS ok FROM dolt_tags WHERE tag_name = $1`, [snapId]);
  if (!exists[0]) {
    throw new brivenError('not_found', `snapshot not found: ${snapId}`, { status: 404 });
  }

  await q(dbName, `SELECT DOLT_RESET('--hard', $1)`, [snapId]);
  const restored = await countUserTables(dbName);
  return { restored };
}

/**
 * Maximum rows examined per table when diffing — retained for API shape and
 * reported back so the UI can phrase "showing the first N rows". DoltGres
 * computes the row delta server-side, so this is an examination ceiling, not a
 * hard cut.
 */
const DIFF_ROW_CAP = 1000;

/** A column present on one side of the diff but not the other. */
export interface ColumnDiff {
  readonly name: string;
  readonly dataType: string;
}

export interface TableRowDiff {
  /** Rows present live but not in the snapshot. */
  readonly added: number;
  /** Rows present in the snapshot but not live. */
  readonly removed: number;
  /** Rows present on both sides whose contents differ. */
  readonly changed: number;
  /** Row count on the live side. */
  readonly liveRowCount: number;
  /** Row count on the snapshot side. */
  readonly snapshotRowCount: number;
  /** True when either side exceeded DIFF_ROW_CAP and the diff is partial. */
  readonly truncated: boolean;
}

/** Per-table diff entry: schema delta + (optional) row delta. */
export interface TableDiff {
  readonly name: string;
  /** Columns present live but absent from the snapshot. */
  readonly columnsAdded: readonly ColumnDiff[];
  /** Columns present in the snapshot but absent live. */
  readonly columnsRemoved: readonly ColumnDiff[];
  /** Row-level delta. Null when it couldn't be computed. */
  readonly rows: TableRowDiff | null;
  /** True when row diffing was skipped (kept for API shape). */
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
  /** Per-table diffs for tables present on BOTH sides but changed. */
  readonly tables: readonly TableDiff[];
  /** The per-table row examination cap (so the UI can phrase truncation). */
  readonly rowCap: number;
}

/** Strip a leading `public.` from a Dolt table name. */
function bareTable(name: string): string {
  return name.startsWith('public.') ? name.slice('public.'.length) : name;
}

/** A function-arg string literal, single-quotes doubled. */
function lit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Best-effort parse of column name → type from a Dolt `CREATE TABLE` body.
 * `AS OF` is unsupported on information_schema in this DoltGres build, so the
 * snapshot-side schema is read from DOLT_SCHEMA_DIFF's create statements.
 */
function parseCreateColumns(stmt: string): Map<string, string> {
  const cols = new Map<string, string>();
  if (!stmt) return cols;
  const open = stmt.indexOf('(');
  const close = stmt.lastIndexOf(')');
  if (open < 0 || close <= open) return cols;
  const body = stmt.slice(open + 1, close);
  const segs: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      segs.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) segs.push(cur);
  const constraintKw = /^(primary|key|unique|constraint|foreign|index|check)\b/i;
  for (const seg of segs) {
    const t = seg.trim();
    if (!t || constraintKw.test(t)) continue;
    const m = t.match(/^["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?\s+(.+)$/s);
    const colName = m?.[1];
    const colType = m?.[2];
    if (colName && colType) cols.set(colName, colType.trim().replace(/\s+/g, ' '));
  }
  return cols;
}

/**
 * Compare a snapshot against the project's CURRENT (WORKING) data and return a
 * structured diff: tables added/removed, per-table columns added/removed, and
 * per-table row delta (added/removed/changed). Strictly read-only. Built on
 * `DOLT_DIFF_SUMMARY` (table/row presence) and `DOLT_DIFF` (per-row delta).
 */
export async function diffSnapshot(projectId: string, snapId: string): Promise<SnapshotDiff> {
  if (!SNAP_ID_RE.test(snapId)) {
    throw new ValidationError('invalid snapshot id', { snapId });
  }
  const dbName = dbNameFor(projectId);

  const tag = (await q(dbName, `SELECT tag_hash, message, date FROM dolt_tags WHERE tag_name = $1`, [
    snapId,
  ])) as Array<{ tag_hash?: unknown; message?: unknown; date?: unknown }>;
  if (!tag[0]) {
    throw new brivenError('not_found', `snapshot not found: ${snapId}`, { status: 404 });
  }
  const meta = parseMeta(String(tag[0].message ?? ''), snapId);
  const snapshotCreatedAt = toIso(tag[0].date);

  // Table-level presence: from = snapshot tag, to = WORKING (live). The tag id
  // is SNAP_ID_RE-validated, so interpolating it into the function call is
  // safe.
  const summary = await q(
    dbName,
    `SELECT from_table_name, to_table_name, diff_type, schema_change
       FROM DOLT_DIFF_SUMMARY(${lit(snapId)}, 'WORKING')`,
  );

  const tablesAdded: string[] = [];
  const tablesRemoved: string[] = [];
  const changedTables: { name: string; schemaChange: boolean }[] = [];
  for (const r of summary) {
    const type = String(r.diff_type ?? '');
    const to = bareTable(String(r.to_table_name ?? ''));
    const from = bareTable(String(r.from_table_name ?? ''));
    if (type === 'added') tablesAdded.push(to || from);
    else if (type === 'removed') tablesRemoved.push(from || to);
    else changedTables.push({ name: to || from, schemaChange: String(r.schema_change) === '1' });
  }

  const tables: TableDiff[] = [];
  for (const { name, schemaChange } of changedTables) {
    // Row delta, grouped by Dolt's diff_type.
    let added = 0;
    let removed = 0;
    let changed = 0;
    try {
      const rows = await q(
        dbName,
        `SELECT diff_type, count(*)::int AS n
           FROM DOLT_DIFF(${lit(snapId)}, 'WORKING', ${lit(name)})
          GROUP BY diff_type`,
      );
      for (const r of rows) {
        const n = Number(r.n) || 0;
        const t = String(r.diff_type ?? '');
        if (t === 'added') added = n;
        else if (t === 'removed') removed = n;
        else if (t === 'modified') changed = n;
      }
    } catch (err) {
      log.warn('snapshot_diff_rows_failed', {
        dbName,
        table: name,
        message: err instanceof Error ? err.message : String(err),
      });
    }

    const liveRowCount = await safeCount(dbName, `SELECT count(*)::int AS n FROM "${name}"`);
    const snapshotRowCount = await safeCount(
      dbName,
      `SELECT count(*)::int AS n FROM "${name}" AS OF ${lit(snapId)}`,
    );

    let columnsAdded: ColumnDiff[] = [];
    let columnsRemoved: ColumnDiff[] = [];
    if (schemaChange) {
      try {
        const sd = await q(
          dbName,
          `SELECT from_create_statement, to_create_statement
             FROM DOLT_SCHEMA_DIFF(${lit(snapId)}, 'WORKING', ${lit(name)})`,
        );
        const fromCols = parseCreateColumns(String(sd[0]?.from_create_statement ?? ''));
        const toCols = parseCreateColumns(String(sd[0]?.to_create_statement ?? ''));
        columnsAdded = [...toCols]
          .filter(([c]) => !fromCols.has(c))
          .map(([name2, dataType]) => ({ name: name2, dataType }));
        columnsRemoved = [...fromCols]
          .filter(([c]) => !toCols.has(c))
          .map(([name2, dataType]) => ({ name: name2, dataType }));
      } catch (err) {
        log.warn('snapshot_diff_schema_failed', {
          dbName,
          table: name,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    tables.push({
      name,
      columnsAdded,
      columnsRemoved,
      rows: {
        added,
        removed,
        changed,
        liveRowCount,
        snapshotRowCount,
        truncated: liveRowCount > DIFF_ROW_CAP || snapshotRowCount > DIFF_ROW_CAP,
      },
      noPrimaryKey: false,
    });
  }

  return {
    snapshotId: snapId,
    snapshotName: meta.l,
    snapshotCreatedAt,
    tablesAdded,
    tablesRemoved,
    tables,
    rowCap: DIFF_ROW_CAP,
  };
}

async function safeCount(dbName: string, sql: string): Promise<number> {
  try {
    const rows = await q(dbName, sql);
    return Number(rows[0]?.n) || 0;
  } catch {
    return 0;
  }
}

/** Delete a snapshot (drops its Dolt tag). Idempotent. */
export async function deleteSnapshot(projectId: string, snapId: string): Promise<void> {
  if (!SNAP_ID_RE.test(snapId)) {
    throw new ValidationError('invalid snapshot id', { snapId });
  }
  const dbName = dbNameFor(projectId);
  const exists = await q(dbName, `SELECT 1 AS ok FROM dolt_tags WHERE tag_name = $1`, [snapId]);
  if (!exists[0]) return;
  await q(dbName, `SELECT DOLT_TAG('-d', $1)`, [snapId]);
}

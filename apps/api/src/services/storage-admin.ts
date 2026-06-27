import { ValidationError } from '@briven/shared';
import { eq, isNull } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { runInProjectDatabase } from '../db/data-plane.js';
import { projects, tierStorageCaps, type ProjectTier } from '../db/schema.js';
import { log } from '../lib/logger.js';

/**
 * Storage admin (sprint plan Sprint 4).
 *
 * DoltGres can't report byte sizes (pg_total_relation_size returns 0 — see
 * services/usage.ts), so the operator dashboard measures what DoltGres CAN
 * count: the number of user tables and the total row count across them.
 *
 * Phase 1 = read-only usage truth. Per-project / per-tier limits + flagging
 * arrive in Phase 2; the admin web page in Phase 3; enforcement (blocking) is
 * a deferred Phase 4. v1 NEVER blocks a customer — it only surfaces usage.
 */

export interface ProjectRowCount {
  /** Total rows summed across every user table (excludes _briven_* bookkeeping). */
  readonly rowCount: number;
  /** Number of user tables (excludes _briven_*). */
  readonly tableCount: number;
}

/**
 * Count tables + total rows in a project's OWN DoltGres database.
 *
 * One connection, one transaction: list the user tables from the catalog (the
 * same pg_class filter getStorageUsage uses — proven on DoltGres), then run a
 * plain COUNT(*) per table and sum in JS. COUNT(*) and the pg_class listing are
 * both DoltGres-safe; no pg_total_relation_size / generate_series.
 *
 * Returns zeros (never throws) when the project DB isn't provisioned yet or a
 * count fails — the dashboard renders that as "—" naturally, exactly like
 * getStorageUsage.
 *
 * N+1 COUNT queries per project is acceptable at current scale (few projects,
 * few tables). If table counts grow large, move this behind the hourly usage
 * aggregator (a periodic snapshot) — flagged in the plan's Notes.
 */
export async function getProjectRowCount(projectId: string): Promise<ProjectRowCount> {
  try {
    return await runInProjectDatabase(projectId, async (tx) => {
      const tables = (await tx.unsafe(`
        SELECT c.relname AS name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')      -- ordinary + partitioned tables
          AND left(c.relname, 8) <> '_briven_'
      `)) as Array<{ name: string }>;

      let rowCount = 0;
      for (const t of tables) {
        // t.name comes from the system catalog (not user input); quote it so
        // mixed-case / reserved names still resolve.
        const counted = (await tx.unsafe(
          `SELECT COUNT(*)::bigint AS n FROM "${t.name}"`,
        )) as Array<{ n: string }>;
        rowCount += counted[0] ? Number.parseInt(counted[0].n, 10) : 0;
      }
      return { rowCount, tableCount: tables.length };
    });
  } catch (err) {
    log.warn('project_row_count_failed', {
      projectId,
      message: err instanceof Error ? err.message : String(err),
    });
    return { rowCount: 0, tableCount: 0 };
  }
}

/* ── Tier storage caps (DB-backed, admin-editable — Phase 2) ─────────────── */

export interface StorageCap {
  readonly maxRows: number;
  readonly maxTables: number;
}

/**
 * The Free/Pro/Team caps from `tier_storage_caps`. Read fresh each call (only
 * the admin page + the per-project flag math hit it; not a hot path) so an
 * edit takes effect immediately.
 */
export async function getTierStorageCaps(): Promise<Record<ProjectTier, StorageCap>> {
  const db = getDb();
  const rows = await db.select().from(tierStorageCaps);
  const out = {} as Record<ProjectTier, StorageCap>;
  for (const r of rows) {
    out[r.tier] = { maxRows: Number(r.maxRows), maxTables: Number(r.maxTables) };
  }
  return out;
}

function assertNonNegInt(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError(`${field} must be a non-negative whole number`, { field, value });
  }
}

/** Update one tier's caps. Takes effect immediately — no redeploy. */
export async function updateTierStorageCap(
  tier: ProjectTier,
  caps: StorageCap,
  actorId: string | null,
): Promise<void> {
  assertNonNegInt(caps.maxRows, 'maxRows');
  assertNonNegInt(caps.maxTables, 'maxTables');
  const db = getDb();
  await db
    .update(tierStorageCaps)
    .set({ maxRows: caps.maxRows, maxTables: caps.maxTables, updatedAt: new Date(), updatedBy: actorId })
    .where(eq(tierStorageCaps.tier, tier));
}

/**
 * Set (or clear) a single project's storage override. Pass null for a field to
 * clear it — the project then inherits its tier cap for that field.
 */
export async function setProjectStorageLimit(
  projectId: string,
  limit: { maxRows: number | null; maxTables: number | null },
  _actorId: string | null,
): Promise<void> {
  if (limit.maxRows != null) assertNonNegInt(limit.maxRows, 'maxRows');
  if (limit.maxTables != null) assertNonNegInt(limit.maxTables, 'maxTables');
  const db = getDb();
  await db
    .update(projects)
    .set({ storageMaxRows: limit.maxRows, storageMaxTables: limit.maxTables, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

/* ── Enforcement mode (Phase 4 — the "block" lever) ──────────────────────── */

export type StorageEnforcement = 'flag' | 'block';
export type StorageWrite = 'row' | 'table';

// Cache the per-project enforcement mode so the hot write path (insertRow /
// createTable) doesn't hit the control DB on every call. 'flag' is the default
// ("never block"), so a briefly-stale 'flag' is harmless; setProjectEnforcement
// invalidates on change, and the short TTL bounds staleness when flipping on.
const ENFORCEMENT_TTL_MS = 30_000;
const enforcementCache = new Map<string, { mode: StorageEnforcement; expires: number }>();

/** The project's enforcement mode, cached. Defaults to 'flag' for unknown ids. */
export async function getProjectEnforcement(projectId: string): Promise<StorageEnforcement> {
  const hit = enforcementCache.get(projectId);
  const now = Date.now();
  if (hit && hit.expires > now) return hit.mode;
  const db = getDb();
  const rows = await db
    .select({ mode: projects.storageEnforcement })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const mode: StorageEnforcement = rows[0]?.mode === 'block' ? 'block' : 'flag';
  enforcementCache.set(projectId, { mode, expires: now + ENFORCEMENT_TTL_MS });
  return mode;
}

/** Flip a project between 'flag' (never blocks) and 'block' (rejects over-cap writes). */
export async function setProjectEnforcement(
  projectId: string,
  mode: StorageEnforcement,
  _actorId: string | null,
): Promise<void> {
  if (mode !== 'flag' && mode !== 'block') {
    throw new ValidationError("enforcement must be 'flag' or 'block'", { mode });
  }
  const db = getDb();
  await db
    .update(projects)
    .set({ storageEnforcement: mode, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
  enforcementCache.delete(projectId); // take effect immediately
}

/** Test-only: drop the in-memory enforcement cache. */
export function _resetEnforcementCache(): void {
  enforcementCache.clear();
}

/**
 * Guard a single storage-growing write (one new row or one new table). In
 * 'flag' mode (the default) this is a no-op fast path — NO row count runs, so
 * normal projects pay nothing. Only a project an admin has flipped to 'block'
 * pays the count, and only that project is ever rejected. Throws a
 * ValidationError (→ 4xx) when the write would push the project over its
 * effective cap (per-project override ?? tier cap). Fails OPEN on a missing
 * project so enforcement can never wedge a legitimate write by accident.
 */
export async function assertWithinStorageLimit(
  projectId: string,
  write: StorageWrite,
): Promise<void> {
  if ((await getProjectEnforcement(projectId)) !== 'block') return; // flag → never blocks

  const db = getDb();
  const projRows = await db
    .select({
      tier: projects.tier,
      storageMaxRows: projects.storageMaxRows,
      storageMaxTables: projects.storageMaxTables,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const proj = projRows[0];
  if (!proj) return; // unknown project → fail open

  const caps = await getTierStorageCaps();
  const tierCap = caps[proj.tier] ?? { maxRows: Infinity, maxTables: Infinity };
  const maxRows = proj.storageMaxRows ?? tierCap.maxRows;
  const maxTables = proj.storageMaxTables ?? tierCap.maxTables;
  const { rowCount, tableCount } = await getProjectRowCount(projectId);

  if (write === 'table' && tableCount + 1 > maxTables) {
    throw new ValidationError(
      `storage limit reached — this project is at its table cap (${maxTables}). Delete a table or raise the limit.`,
      { projectId, tableCount, maxTables, write },
    );
  }
  if (write === 'row' && rowCount + 1 > maxRows) {
    throw new ValidationError(
      `storage limit reached — this project is at its row cap (${maxRows}). Delete rows or raise the limit.`,
      { projectId, rowCount, maxRows, write },
    );
  }
}

/* ── Over-limit flag math (pure — unit tested) ───────────────────────────── */

export interface LimitFlags {
  readonly overRows: boolean;
  readonly overTables: boolean;
  readonly overLimit: boolean;
}

/**
 * Pure over-limit decision. "At the cap" is NOT over (strictly greater than).
 * Extracted so the flag math is unit-tested without a database.
 */
export function evaluateStorageLimit(input: {
  rowCount: number;
  tableCount: number;
  maxRows: number;
  maxTables: number;
}): LimitFlags {
  const overRows = input.rowCount > input.maxRows;
  const overTables = input.tableCount > input.maxTables;
  return { overRows, overTables, overLimit: overRows || overTables };
}

/* ── Usage list with over-limit flagging (Phase 2) ───────────────────────── */

export interface ProjectStorageUsage {
  readonly id: string;
  readonly name: string;
  readonly tier: ProjectTier;
  readonly tableCount: number;
  readonly rowCount: number;
  /** Effective caps = per-project override ?? tier cap. */
  readonly maxRows: number;
  readonly maxTables: number;
  /** True when the per-project override is set (vs inheriting the tier cap). */
  readonly hasOverride: boolean;
  /** Enforcement mode: 'flag' (surface only) or 'block' (reject over-cap writes). */
  readonly enforcement: StorageEnforcement;
  readonly overRows: boolean;
  readonly overTables: boolean;
  readonly overLimit: boolean;
}

/**
 * Usage for every live project, with effective caps + over-limit flags — drives
 * the admin storage page. Counts run in parallel across projects (each hits a
 * different project DB pool). v1 only FLAGS (overLimit); enforcement/blocking is
 * the deferred Phase 4.
 */
export async function listStorageUsage(): Promise<readonly ProjectStorageUsage[]> {
  const db = getDb();
  const caps = await getTierStorageCaps();
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      tier: projects.tier,
      storageMaxRows: projects.storageMaxRows,
      storageMaxTables: projects.storageMaxTables,
      storageEnforcement: projects.storageEnforcement,
    })
    .from(projects)
    .where(isNull(projects.deletedAt));

  return Promise.all(
    rows.map(async (p) => {
      const { rowCount, tableCount } = await getProjectRowCount(p.id);
      // Missing tier cap (shouldn't happen post-seed) → Infinity = never over.
      const tierCap = caps[p.tier] ?? { maxRows: Infinity, maxTables: Infinity };
      const maxRows = p.storageMaxRows ?? tierCap.maxRows;
      const maxTables = p.storageMaxTables ?? tierCap.maxTables;
      const flags = evaluateStorageLimit({ rowCount, tableCount, maxRows, maxTables });
      return {
        id: p.id,
        name: p.name,
        tier: p.tier,
        tableCount,
        rowCount,
        maxRows,
        maxTables,
        hasOverride: p.storageMaxRows != null || p.storageMaxTables != null,
        enforcement: (p.storageEnforcement ?? 'flag') as StorageEnforcement,
        ...flags,
      };
    }),
  );
}

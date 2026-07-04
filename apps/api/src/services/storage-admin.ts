import { ValidationError } from '@briven/shared';
import { eq, isNull, sql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { runInProjectDatabase } from '../db/data-plane.js';
import { projectFiles, projects, storageKeys, tierStorageCaps, type ProjectTier } from '../db/schema.js';
import { log } from '../lib/logger.js';
import { TIERS } from './tiers.js';

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
        ...flags,
      };
    }),
  );
}

/* ── Object-storage (S3/file) usage mirror (read-only) ───────────────────── */

export interface ObjectStorageUsage {
  readonly id: string;
  readonly name: string;
  readonly tier: ProjectTier;
  /** SUM of non-deleted project_files.size_bytes (TEXT → number in SQL). */
  readonly usedBytes: number;
  /** Tier storage byte cap (TIERS[tier].storageBytes). */
  readonly capBytes: number;
  /** File-recovery window in days (TIERS[tier].storageRecoveryDays). */
  readonly recoveryDays: number;
  /** Count of active (not-revoked) storage_keys for the project. */
  readonly keyCount: number;
  readonly over: boolean;
}

/**
 * Read-only object-storage mirror for the admin storage page. Additive to the
 * DoltGres row/table view above: this reports each live project's S3 file usage
 * (sum of non-deleted project_files bytes) against its tier byte cap, its
 * recovery window, and its active storage-key count.
 *
 * Uses the SAME project source as listStorageUsage (so the same projects, with
 * their tier, appear) and TWO grouped aggregate queries — one over project_files,
 * one over storage_keys — joined to the project list in JS via Maps. No per-
 * project queries. size_bytes is TEXT, so it's cast to numeric in SQL and read
 * back as a number (missing project → 0).
 */
export async function listObjectStorageUsage(): Promise<readonly ObjectStorageUsage[]> {
  const db = getDb();

  const rows = await db
    .select({ id: projects.id, name: projects.name, tier: projects.tier })
    .from(projects)
    .where(isNull(projects.deletedAt));

  // Grouped SUM of non-deleted file bytes per project (size_bytes is TEXT).
  const byteRows = await db
    .select({
      projectId: projectFiles.projectId,
      usedBytes: sql<number>`coalesce(sum(cast(${projectFiles.sizeBytes} as bigint)), 0)::bigint`,
    })
    .from(projectFiles)
    .where(isNull(projectFiles.deletedAt))
    .groupBy(projectFiles.projectId);
  const bytesByProject = new Map<string, number>();
  for (const r of byteRows) bytesByProject.set(r.projectId, Number(r.usedBytes) || 0);

  // Grouped count of active (not-revoked) storage keys per project.
  const keyRows = await db
    .select({
      projectId: storageKeys.projectId,
      keyCount: sql<number>`count(*)::int`,
    })
    .from(storageKeys)
    .where(isNull(storageKeys.revokedAt))
    .groupBy(storageKeys.projectId);
  const keysByProject = new Map<string, number>();
  for (const r of keyRows) keysByProject.set(r.projectId, Number(r.keyCount) || 0);

  return rows.map((p) => {
    const usedBytes = bytesByProject.get(p.id) ?? 0;
    const capBytes = TIERS[p.tier].storageBytes;
    return {
      id: p.id,
      name: p.name,
      tier: p.tier,
      usedBytes,
      capBytes,
      recoveryDays: TIERS[p.tier].storageRecoveryDays,
      keyCount: keysByProject.get(p.id) ?? 0,
      over: usedBytes > capBytes,
    };
  });
}

import { newId, ValidationError } from '@briven/shared';
import { and, asc, eq, lte } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  autoSnapshotFrequency,
  projectAutoSnapshotSettings,
  type AutoSnapshotFrequency,
  type AutoSnapshotRunStatus,
  type ProjectAutoSnapshotSettings,
} from '../db/schema.js';

/**
 * Automatic scheduled snapshots — the control-plane settings + scheduling
 * logic behind Briven's auto save-points. One row per project in
 * `project_auto_snapshot_settings`; the worker (workers/auto-snapshot.ts)
 * claims due rows, calls createSnapshot({ auto: true }), then prunes auto
 * snapshots beyond retentionCount. Manual snapshots are never touched.
 *
 * Cadence is intentionally simple (daily / twice-daily) rather than a full
 * cron — non-coders pick "once a day" or "twice a day", and we anchor the
 * runs to fixed UTC hours so they're predictable and don't drift.
 */

/** UTC hours each frequency fires at. Twice-daily = ~02:00 and ~14:00. */
const DAILY_HOURS = [2];
const TWICE_DAILY_HOURS = [2, 14];

const MIN_RETENTION = 1;
const MAX_RETENTION = 90;
const MAX_ERROR_LEN = 500;

function hoursFor(frequency: AutoSnapshotFrequency): number[] {
  return frequency === 'twice_daily' ? TWICE_DAILY_HOURS : DAILY_HOURS;
}

/**
 * Next fire time strictly after `from`, anchored to the frequency's fixed
 * UTC hours. Walks today's slots, then tomorrow's first slot, so the result
 * is always in the future regardless of when called.
 */
export function nextAutoRunAfter(frequency: AutoSnapshotFrequency, from: Date): Date {
  const hours = hoursFor(frequency);
  for (const h of hours) {
    const candidate = new Date(from);
    candidate.setUTCHours(h, 0, 0, 0);
    if (candidate.getTime() > from.getTime()) return candidate;
  }
  // All of today's slots are in the past — take tomorrow's first slot.
  const next = new Date(from);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(hours[0] ?? 2, 0, 0, 0);
  return next;
}

export interface AutoSnapshotSettingsView {
  readonly enabled: boolean;
  readonly frequency: AutoSnapshotFrequency;
  readonly retentionCount: number;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly lastRunStatus: AutoSnapshotRunStatus | null;
  readonly lastRunError: string | null;
}

/** The default a project gets before it has ever configured auto-snapshots. */
const DISABLED_DEFAULTS: AutoSnapshotSettingsView = {
  enabled: false,
  frequency: 'daily',
  retentionCount: 7,
  nextRunAt: null,
  lastRunAt: null,
  lastRunStatus: null,
  lastRunError: null,
};

function toView(row: ProjectAutoSnapshotSettings): AutoSnapshotSettingsView {
  return {
    enabled: row.enabled,
    frequency: row.frequency,
    retentionCount: row.retentionCount,
    nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : null,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    lastRunStatus: row.lastRunStatus ?? null,
    lastRunError: row.lastRunError ?? null,
  };
}

/**
 * Read a project's auto-snapshot settings. Returns disabled defaults when
 * the project has never configured them (no row yet) so the dashboard
 * always has something to render.
 */
export async function getAutoSnapshotSettings(
  projectId: string,
): Promise<AutoSnapshotSettingsView> {
  const db = getDb();
  const rows = await db
    .select()
    .from(projectAutoSnapshotSettings)
    .where(eq(projectAutoSnapshotSettings.projectId, projectId))
    .limit(1);
  const row = rows[0];
  return row ? toView(row) : DISABLED_DEFAULTS;
}

export interface UpdateAutoSnapshotInput {
  enabled: boolean;
  frequency: AutoSnapshotFrequency;
  retentionCount: number;
  updatedBy: string | null;
}

function validateInput(input: UpdateAutoSnapshotInput): void {
  if (typeof input.enabled !== 'boolean') {
    throw new ValidationError('enabled must be true or false');
  }
  if (!autoSnapshotFrequency.includes(input.frequency)) {
    throw new ValidationError(`frequency must be one of: ${autoSnapshotFrequency.join(', ')}`);
  }
  if (
    !Number.isInteger(input.retentionCount) ||
    input.retentionCount < MIN_RETENTION ||
    input.retentionCount > MAX_RETENTION
  ) {
    throw new ValidationError(
      `retentionCount must be a whole number between ${MIN_RETENTION} and ${MAX_RETENTION}`,
    );
  }
}

/**
 * Create or update a project's auto-snapshot settings (upsert on
 * project_id). When enabled, next_run_at is set to the next slot for the
 * chosen frequency so the worker picks it up; when disabled, next_run_at is
 * still kept current so re-enabling doesn't back-fire a stale run.
 */
export async function upsertAutoSnapshotSettings(
  projectId: string,
  input: UpdateAutoSnapshotInput,
): Promise<AutoSnapshotSettingsView> {
  validateInput(input);
  const db = getDb();
  const now = new Date();
  const nextRunAt = nextAutoRunAfter(input.frequency, now);

  const inserted = await db
    .insert(projectAutoSnapshotSettings)
    .values({
      id: newId('as'),
      projectId,
      enabled: input.enabled,
      frequency: input.frequency,
      retentionCount: input.retentionCount,
      nextRunAt,
      createdBy: input.updatedBy,
    })
    .onConflictDoUpdate({
      target: projectAutoSnapshotSettings.projectId,
      set: {
        enabled: input.enabled,
        frequency: input.frequency,
        retentionCount: input.retentionCount,
        // Recompute the next slot from the (possibly changed) frequency so a
        // user toggling settings never leaves a stale next_run_at behind.
        nextRunAt,
        updatedAt: now,
      },
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error('auto-snapshot settings upsert returned no row');
  return toView(row);
}

/** A due auto-snapshot settings row, projected for the worker. */
export interface DueAutoSnapshot {
  readonly id: string;
  readonly projectId: string;
  readonly frequency: AutoSnapshotFrequency;
  readonly retentionCount: number;
  readonly nextRunAt: Date;
}

/**
 * Claim auto-snapshot rows that are due: enabled and next_run_at <= now.
 * Optimistic claim (plain SELECT, no row lock) — the worker advances
 * next_run_at via recordAutoSnapshotResult guarded by the pre-claim value,
 * so two workers can't double-fire the same project.
 */
export async function claimDueAutoSnapshots(
  now: Date,
  limit: number,
): Promise<DueAutoSnapshot[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: projectAutoSnapshotSettings.id,
      projectId: projectAutoSnapshotSettings.projectId,
      frequency: projectAutoSnapshotSettings.frequency,
      retentionCount: projectAutoSnapshotSettings.retentionCount,
      nextRunAt: projectAutoSnapshotSettings.nextRunAt,
    })
    .from(projectAutoSnapshotSettings)
    .where(
      and(
        eq(projectAutoSnapshotSettings.enabled, true),
        lte(projectAutoSnapshotSettings.nextRunAt, now),
      ),
    )
    .orderBy(asc(projectAutoSnapshotSettings.nextRunAt))
    .limit(limit);
  return rows;
}

/**
 * Record the outcome of an auto-snapshot run and advance next_run_at. The
 * UPDATE is guarded by the claimed next_run_at so a second worker that
 * claimed the same row loses the race (0 rows updated) and skips silently.
 * Returns true when this caller won the race and the row was advanced.
 */
export async function recordAutoSnapshotResult(input: {
  settingsId: string;
  claimedNextRunAt: Date;
  newNextRunAt: Date;
  ranAt: Date;
  status: AutoSnapshotRunStatus;
  errorMessage?: string;
}): Promise<boolean> {
  const db = getDb();
  const result = await db
    .update(projectAutoSnapshotSettings)
    .set({
      nextRunAt: input.newNextRunAt,
      lastRunAt: input.ranAt,
      lastRunStatus: input.status,
      lastRunError: input.errorMessage ? input.errorMessage.slice(0, MAX_ERROR_LEN) : null,
      updatedAt: input.ranAt,
    })
    .where(
      and(
        eq(projectAutoSnapshotSettings.id, input.settingsId),
        // Guard: only advance if next_run_at is still the value we claimed.
        eq(projectAutoSnapshotSettings.nextRunAt, input.claimedNextRunAt),
      ),
    )
    .returning({ id: projectAutoSnapshotSettings.id });
  return result.length > 0;
}

// Exported for the worker + tests.
export const _internals = { nextAutoRunAfter, DAILY_HOURS, TWICE_DAILY_HOURS };

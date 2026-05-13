import { newId, NotFoundError, ValidationError } from '@briven/shared';
import { and, asc, eq, isNull, lte, sql as drizzleSql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  projectSchedules,
  type ProjectSchedule,
  type ScheduleRunStatus,
} from '../db/schema.js';

/**
 * Cron-triggered function invocations. Scope of this iteration:
 *
 *   - 5-field UTC cron expressions only (minute hour dom month dow). No
 *     seconds, no L/W/#, no per-project timezones. UTC keeps the dispatcher
 *     dst-immune and avoids time-zone-by-project state.
 *   - Aliases: @hourly @daily @weekly @monthly @yearly @midnight.
 *   - One row per (project, name) among non-deleted rows; soft-deleted
 *     names can be reused.
 *   - The dispatcher (workers/schedule-dispatcher.ts) claims due rows by
 *     bumping next_run_at forward in the same UPDATE that records the
 *     run outcome — optimistic concurrency, no explicit row lock.
 */

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const FUNCTION_NAME_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]{0,128}$/;
const MAX_NEXT_RUN_SEARCH_MIN = 366 * 24 * 60;

interface CronSets {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>; // 1-12
  daysOfWeek: Set<number>; // 0-6, sun=0
  // dom and dow are OR'd per POSIX cron semantics when both are
  // non-wildcard. The parser sets these flags so nextRunAfter can pick
  // the right branch without re-inspecting the source string.
  domRestricted: boolean;
  dowRestricted: boolean;
}

const ALIASES: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
};

function expandField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) {
      throw new ValidationError(`invalid step in cron field "${field}"`);
    }
    let lo: number;
    let hi: number;
    if (rangePart === undefined || rangePart === '*') {
      lo = min;
      hi = max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-');
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = Number(rangePart);
      hi = lo;
    }
    if (
      !Number.isInteger(lo) ||
      !Number.isInteger(hi) ||
      lo < min ||
      hi > max ||
      lo > hi
    ) {
      throw new ValidationError(`invalid range "${rangePart}" in cron field "${field}"`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  if (out.size === 0) {
    throw new ValidationError(`cron field "${field}" matches no values`);
  }
  return out;
}

export function parseCron(expression: string): CronSets {
  const normalised = expression.trim();
  const resolved = ALIASES[normalised] ?? normalised;
  const fields = resolved.split(/\s+/);
  if (fields.length !== 5) {
    throw new ValidationError(
      `cron expression must have 5 fields (minute hour day month dow); got ${fields.length}`,
    );
  }
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];
  return {
    minutes: expandField(minute, 0, 59),
    hours: expandField(hour, 0, 23),
    daysOfMonth: expandField(dom, 1, 31),
    months: expandField(month, 1, 12),
    // dow accepts 0-6 (sun=0). 7 → 0 as a convenience. We expand 7 manually.
    daysOfWeek: expandField(dow.replace(/\b7\b/g, '0'), 0, 6),
    domRestricted: dom !== '*',
    dowRestricted: dow !== '*',
  };
}

/**
 * First UTC minute strictly after `from` that satisfies `sets`. Throws if
 * no match is found within one year — that means the expression is valid
 * by field but unreachable (e.g. `0 0 30 2 *` — Feb 30).
 */
export function nextRunAfter(sets: CronSets, from: Date): Date {
  // Start at next minute boundary (drop seconds + ms, then +1 min).
  const start = new Date(from);
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);

  for (let i = 0; i < MAX_NEXT_RUN_SEARCH_MIN; i += 1) {
    const candidate = new Date(start.getTime() + i * 60_000);
    if (!sets.minutes.has(candidate.getUTCMinutes())) continue;
    if (!sets.hours.has(candidate.getUTCHours())) continue;
    if (!sets.months.has(candidate.getUTCMonth() + 1)) continue;
    const domHit = sets.daysOfMonth.has(candidate.getUTCDate());
    const dowHit = sets.daysOfWeek.has(candidate.getUTCDay());
    // POSIX cron: if BOTH dom and dow are restricted, fire when EITHER
    // matches. If only one is restricted, that one must match. If
    // neither is restricted both sets are full so this resolves the
    // same way.
    if (sets.domRestricted && sets.dowRestricted) {
      if (!domHit && !dowHit) continue;
    } else if (sets.domRestricted) {
      if (!domHit) continue;
    } else if (sets.dowRestricted) {
      if (!dowHit) continue;
    } else if (!domHit || !dowHit) {
      // both wildcard → both sets full, defensive
      continue;
    }
    return candidate;
  }
  throw new ValidationError(
    'cron expression has no valid next run within one year (impossible date?)',
  );
}

export interface CreateScheduleInput {
  projectId: string;
  name: string;
  functionName: string;
  cronExpression: string;
  args?: Record<string, unknown>;
  enabled?: boolean;
  createdBy: string | null;
}

export interface UpdateScheduleInput {
  name?: string;
  functionName?: string;
  cronExpression?: string;
  args?: Record<string, unknown>;
  enabled?: boolean;
}

function validateName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new ValidationError(
      'schedule name must be 1-64 chars: alphanumerics, underscore, hyphen; must start with alphanumeric',
    );
  }
}

function validateFunctionName(fn: string): void {
  if (!FUNCTION_NAME_RE.test(fn)) {
    throw new ValidationError('function name must be a valid javascript identifier');
  }
}

export async function listSchedules(projectId: string): Promise<ProjectSchedule[]> {
  const db = getDb();
  return db
    .select()
    .from(projectSchedules)
    .where(
      and(eq(projectSchedules.projectId, projectId), isNull(projectSchedules.deletedAt)),
    )
    .orderBy(asc(projectSchedules.name));
}

export async function getSchedule(
  scheduleId: string,
  projectId: string,
): Promise<ProjectSchedule> {
  const db = getDb();
  const rows = await db
    .select()
    .from(projectSchedules)
    .where(
      and(
        eq(projectSchedules.id, scheduleId),
        eq(projectSchedules.projectId, projectId),
        isNull(projectSchedules.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('schedule', scheduleId);
  return row;
}

export async function createSchedule(input: CreateScheduleInput): Promise<ProjectSchedule> {
  validateName(input.name);
  validateFunctionName(input.functionName);
  const sets = parseCron(input.cronExpression);
  const nextRunAt = nextRunAfter(sets, new Date());

  const db = getDb();
  const id = newId('sch');
  const row = {
    id,
    projectId: input.projectId,
    name: input.name,
    functionName: input.functionName,
    cronExpression: input.cronExpression.trim(),
    args: input.args ?? {},
    enabled: input.enabled ?? true,
    nextRunAt,
    createdBy: input.createdBy,
  };

  try {
    const inserted = await db.insert(projectSchedules).values(row).returning();
    if (!inserted[0]) throw new Error('insert returned no row');
    return inserted[0];
  } catch (err) {
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
      throw new ValidationError(`a schedule named "${input.name}" already exists for this project`);
    }
    throw err;
  }
}

export async function updateSchedule(
  scheduleId: string,
  projectId: string,
  patch: UpdateScheduleInput,
): Promise<ProjectSchedule> {
  // Load first so an attempted edit against a non-existent / cross-project
  // id 404s instead of silently no-op'ing.
  const existing = await getSchedule(scheduleId, projectId);

  const updates: Partial<ProjectSchedule> = { updatedAt: new Date() };

  if (patch.name !== undefined && patch.name !== existing.name) {
    validateName(patch.name);
    updates.name = patch.name;
  }
  if (patch.functionName !== undefined && patch.functionName !== existing.functionName) {
    validateFunctionName(patch.functionName);
    updates.functionName = patch.functionName;
  }
  if (
    patch.cronExpression !== undefined &&
    patch.cronExpression.trim() !== existing.cronExpression
  ) {
    const sets = parseCron(patch.cronExpression);
    updates.cronExpression = patch.cronExpression.trim();
    updates.nextRunAt = nextRunAfter(sets, new Date());
  }
  if (patch.args !== undefined) updates.args = patch.args;
  if (patch.enabled !== undefined && patch.enabled !== existing.enabled) {
    updates.enabled = patch.enabled;
    // Re-enabling a schedule whose next_run_at is in the past would fire
    // on the next dispatcher tick — fine when intentional (catch-up). To
    // avoid surprise back-fills, push next_run_at forward to the next
    // valid slot from now.
    if (patch.enabled) {
      const sets = parseCron(updates.cronExpression ?? existing.cronExpression);
      updates.nextRunAt = nextRunAfter(sets, new Date());
    }
  }

  const db = getDb();
  const result = await db
    .update(projectSchedules)
    .set(updates)
    .where(and(eq(projectSchedules.id, scheduleId), eq(projectSchedules.projectId, projectId)))
    .returning();
  if (!result[0]) throw new NotFoundError('schedule', scheduleId);
  return result[0];
}

export async function deleteSchedule(scheduleId: string, projectId: string): Promise<void> {
  const db = getDb();
  const result = await db
    .update(projectSchedules)
    .set({ deletedAt: new Date(), enabled: false, updatedAt: new Date() })
    .where(
      and(
        eq(projectSchedules.id, scheduleId),
        eq(projectSchedules.projectId, projectId),
        isNull(projectSchedules.deletedAt),
      ),
    )
    .returning({ id: projectSchedules.id });
  if (!result[0]) throw new NotFoundError('schedule', scheduleId);
}

/**
 * Dispatcher claim path. Selects up to `limit` schedules whose next_run_at
 * is in the past, returning them with their pre-claim values. The caller
 * is expected to compute the new next_run_at locally, invoke the function,
 * and call recordScheduleResult — which performs an UPDATE guarded by the
 * pre-claim next_run_at so two concurrent dispatchers can't double-fire.
 */
export async function claimDueSchedules(
  now: Date,
  limit: number,
): Promise<ProjectSchedule[]> {
  const db = getDb();
  return db
    .select()
    .from(projectSchedules)
    .where(
      and(
        eq(projectSchedules.enabled, true),
        isNull(projectSchedules.deletedAt),
        lte(projectSchedules.nextRunAt, now),
      ),
    )
    .orderBy(asc(projectSchedules.nextRunAt))
    .limit(limit);
}

/**
 * Records a run outcome and advances next_run_at. The WHERE clause checks
 * the pre-claim next_run_at so a concurrent dispatcher that already moved
 * the row forward will get rowsAffected=0 and skip recording.
 *
 * Returns whether the update was applied — callers can log a "lost race"
 * counter when this returns false.
 */
export async function recordScheduleResult(input: {
  scheduleId: string;
  claimedNextRunAt: Date;
  newNextRunAt: Date;
  ranAt: Date;
  status: ScheduleRunStatus;
  errorMessage?: string;
}): Promise<boolean> {
  const db = getDb();
  const result = await db
    .update(projectSchedules)
    .set({
      nextRunAt: input.newNextRunAt,
      lastRunAt: input.ranAt,
      lastRunStatus: input.status,
      lastRunError: input.errorMessage ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projectSchedules.id, input.scheduleId),
        eq(projectSchedules.nextRunAt, input.claimedNextRunAt),
      ),
    )
    .returning({ id: projectSchedules.id });
  return result.length > 0;
}

// Re-export drizzle's sql tag for callers that need raw expressions on
// the schedules table. Kept here so route + worker files don't have to
// reach into drizzle-orm directly.
export { drizzleSql };

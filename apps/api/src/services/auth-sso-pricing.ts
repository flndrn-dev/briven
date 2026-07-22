/**
 * Phase 5.7 — per-connection SSO pricing hooks.
 *
 * Emits usage_events so Polar (when meters are configured) can bill
 * enterprise SSO: active connection count (gauge) + sign-in volume (delta).
 * Never throws into the SSO sign-in path — fire-and-forget from callers.
 */

import { sql } from 'drizzle-orm';

import { newId } from '@briven/shared';

import { getDb } from '../db/client.js';
import { usageEvents, type UsageMetric } from '../db/schema.js';
import { log } from '../lib/logger.js';
import { runInProjectDatabase } from '../db/data-plane.js';

/** UTC hour bucket start for usage_events.period_start. */
export function currentUtcHourStart(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), 0, 0, 0),
  );
}

/**
 * Increment the hourly SSO sign-in counter for a project (after a successful
 * IdP login). Safe to call with await void; swallows errors.
 */
export async function recordSsoSignInUsage(
  projectId: string,
  connectionId: string,
): Promise<void> {
  try {
    const periodStart = currentUtcHourStart();
    const db = getDb();
    await db
      .insert(usageEvents)
      .values({
        id: newId('au'),
        projectId,
        metric: 'auth_sso_signins' as UsageMetric,
        periodStart,
        value: '1',
        polarPushStatus: 'pending',
      })
      .onConflictDoUpdate({
        target: [usageEvents.projectId, usageEvents.periodStart, usageEvents.metric],
        set: {
          value: sql`(${usageEvents.value}::bigint + 1)::text`,
          polarPushStatus: 'pending',
          polarPushedAt: null,
        },
      });
    log.info('auth_sso_signin_metered', { projectId, connectionId });
  } catch (err) {
    log.warn('auth_sso_signin_meter_failed', {
      projectId,
      connectionId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Snapshot how many active (non-deactivated) SSO connections a project has.
 * Called from the hourly usage aggregator and after connection create/delete.
 */
export async function countActiveSsoConnections(projectId: string): Promise<number> {
  return runInProjectDatabase(projectId, async (tx) => {
    const rows = (await tx.unsafe(
      `SELECT count(*)::int AS c FROM "_briven_auth_sso_connections" WHERE deactivated_at IS NULL`,
    )) as Array<{ c: number }>;
    return Number(rows[0]?.c ?? 0);
  });
}

export async function recordSsoConnectionGauge(
  projectId: string,
  count?: number,
): Promise<void> {
  try {
    const value = count ?? (await countActiveSsoConnections(projectId));
    const periodStart = currentUtcHourStart();
    const db = getDb();
    await db
      .insert(usageEvents)
      .values({
        id: newId('au'),
        projectId,
        metric: 'auth_sso_connections' as UsageMetric,
        periodStart,
        value: String(value),
        polarPushStatus: 'pending',
      })
      .onConflictDoUpdate({
        target: [usageEvents.projectId, usageEvents.periodStart, usageEvents.metric],
        set: {
          value: String(value),
          polarPushStatus: 'pending',
          polarPushedAt: null,
        },
      });
    log.info('auth_sso_connections_metered', { projectId, count: value });
  } catch (err) {
    log.warn('auth_sso_connections_meter_failed', {
      projectId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

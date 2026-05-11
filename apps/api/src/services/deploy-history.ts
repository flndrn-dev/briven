import { desc, eq } from 'drizzle-orm';

import { newId } from '@briven/shared';

import { getDb } from '../db/client.js';
import { deployHistory, type DeployHistoryEntry } from '../db/schema.js';
import { log } from '../lib/logger.js';

/**
 * Records one row in deploy_history per api boot. Best-effort: a failed
 * insert is logged but never bubbles up — the api still serves requests
 * if the audit-trail table is unreachable. Returns the inserted row id
 * (or null on failure) so tests / callers can assert it ran.
 */
export async function recordDeploy(args: {
  service: string;
  buildSha: string;
  buildAt: string | null;
  env: string;
}): Promise<string | null> {
  // "dev" is the explicit "we don't have build identity" sentinel from
  // health.ts. Recording it would pollute the deploy timeline with noise
  // on every local `bun dev` boot — skip the row in that case.
  if (args.buildSha === 'dev') {
    return null;
  }
  try {
    const db = getDb();
    const id = newId('dh');
    await db.insert(deployHistory).values({
      id,
      service: args.service,
      buildSha: args.buildSha,
      buildAt: args.buildAt,
      env: args.env,
    });
    log.info('deploy_history_recorded', {
      service: args.service,
      buildSha: args.buildSha.slice(0, 12),
      env: args.env,
    });
    return id;
  } catch (err) {
    log.warn('deploy_history_insert_failed', {
      service: args.service,
      buildSha: args.buildSha.slice(0, 12),
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Most-recent N deploys for the admin "Deploys" widget. Optionally
 * filtered to one service (api / realtime / runtime) — when omitted we
 * return the merged stream so the operator sees the actual rollout
 * sequence across services.
 */
export async function listDeploys(
  args: { service?: string; limit?: number } = {},
): Promise<DeployHistoryEntry[]> {
  const db = getDb();
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 500);
  if (args.service) {
    return db
      .select()
      .from(deployHistory)
      .where(eq(deployHistory.service, args.service))
      .orderBy(desc(deployHistory.bootedAt))
      .limit(limit);
  }
  return db.select().from(deployHistory).orderBy(desc(deployHistory.bootedAt)).limit(limit);
}

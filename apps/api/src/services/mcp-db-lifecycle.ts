import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  checkProjectDbHealth,
  dropProjectDatabase,
  evictProjectPool,
  provisionProjectDatabase,
} from '../db/data-plane.js';
import { createSnapshot, listSnapshots, restoreSnapshot } from './snapshots.js';

/**
 * Database lifecycle tools for the per-project MCP (Build 4, owner-ordered
 * 2026-07-07 after a tenant agent found there was NO restart / recover /
 * reprovision surface anywhere — not even manual).
 *
 * Scope ladder (registered by mcp-tools.ts):
 *   read scope      → db_health, db_recovery_points
 *   read-write      → + db_restart, db_recover
 *   admin           → + db_reprovision
 *
 * Safety design:
 *   - db_restart touches CONNECTIONS only, never data.
 *   - db_recover auto-tags the CURRENT state as a pre-recovery snapshot
 *     first, so a recovery is itself always undoable, and requires the
 *     literal confirm string "RECOVER".
 *   - db_reprovision is the nuclear option (drop + recreate EMPTY — all
 *     tables, rows, AND snapshots/history are destroyed, unrecoverable).
 *     Admin-scope keys only, requires confirm "REPROVISION", and refuses
 *     to run while the database still answers health checks with tables
 *     present unless `force` is set — a working database should be
 *     recovered, not razed.
 */

export function registerDbLifecycleReadTools(
  server: McpServer,
  ctx: { projectId: string },
  auditCall: (tool: string, metadata: Record<string, unknown>) => Promise<void>,
  jsonResult: (payload: unknown) => { content: { type: 'text'; text: string }[] },
): void {
  server.registerTool(
    'db_health',
    {
      title: 'Database health check',
      description:
        'Probe YOUR project database: reachable?, query latency, user-table count, and ' +
        'the current version-history HEAD commit. Read-only, safe to call any time. ' +
        'If this reports unreachable, try db_restart (write scope) before anything else.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      await auditCall('db_health', {});
      const health = await checkProjectDbHealth(ctx.projectId);
      return jsonResult({
        ...health,
        guidance: health.reachable
          ? 'database answering normally. nothing to do.'
          : 'database did not answer. next step: db_restart (needs a write-scope key) resets the connection pool without touching data. if still unreachable after restart, this is a platform incident — escalate to the project owner.',
      });
    },
  );

  server.registerTool(
    'db_recovery_points',
    {
      title: 'List database recovery points',
      description:
        'List YOUR project database\'s snapshots (recovery points): id, name, table ' +
        'count, creation time, and whether it was automatic. Use an id from this list ' +
        'with db_recover to roll the database back to that exact state. Read-only.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      await auditCall('db_recovery_points', {});
      const snapshots = await listSnapshots(ctx.projectId);
      return jsonResult({
        count: snapshots.length,
        snapshots,
        guidance:
          snapshots.length === 0
            ? 'no snapshots yet — the database has no saved recovery points. consider creating one from the dashboard before risky operations; automatic snapshots also accumulate over time.'
            : 'to roll back, call db_recover (write scope) with one of these snapshot ids and confirm:"RECOVER". a pre-recovery snapshot of the current state is taken automatically, so recovery is undoable.',
      });
    },
  );
}

export function registerDbLifecycleWriteTools(
  server: McpServer,
  ctx: { projectId: string },
  auditCall: (tool: string, metadata: Record<string, unknown>) => Promise<void>,
  jsonResult: (payload: unknown) => { content: { type: 'text'; text: string }[] },
): void {
  server.registerTool(
    'db_restart',
    {
      title: 'Restart database connections',
      description:
        'Restart YOUR project database\'s connection pool: closes every cached ' +
        'connection and reconnects fresh (new auth handshake). Touches CONNECTIONS ' +
        'only — never data. This is the first fix for "database not responding" / ' +
        'stuck-connection symptoms. Returns a post-restart health check. (Write scope.)',
      annotations: { readOnlyHint: false },
    },
    async () => {
      await auditCall('db_restart', {});
      const hadPool = await evictProjectPool(ctx.projectId);
      const health = await checkProjectDbHealth(ctx.projectId);
      return jsonResult({
        restarted: true,
        hadCachedPool: hadPool,
        healthAfterRestart: health,
        guidance: health.reachable
          ? 'restart complete and the database answers. re-run your failed operation now.'
          : 'restarted, but the database STILL does not answer — this is beyond a connection problem. do not retry in a loop; escalate to the project owner as a platform incident, quoting the error above.',
      });
    },
  );

  server.registerTool(
    'db_recover',
    {
      title: 'Recover database to a snapshot',
      description:
        'Roll YOUR project database back to a recovery point from db_recovery_points. ' +
        'DESTRUCTIVE for changes made after that snapshot — but the CURRENT state is ' +
        'auto-saved as a new pre-recovery snapshot first, so the recovery itself can be ' +
        'undone by recovering to that. Requires confirm:"RECOVER". (Write scope.)',
      inputSchema: {
        snapshotId: z.string().min(1).describe('A snapshot id from db_recovery_points'),
        confirm: z
          .string()
          .describe('Must be exactly "RECOVER" — proves this is not an accidental call'),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ snapshotId, confirm }) => {
      if (confirm !== 'RECOVER') {
        throw new Error('refused: confirm must be exactly "RECOVER" (destructive operation)');
      }
      await auditCall('db_recover', { snapshotId });
      // Tag the CURRENT state first — recovery must always be undoable.
      const preRecovery = await createSnapshot(ctx.projectId, `pre-recover ${snapshotId}`, {
        auto: false,
      });
      const result = await restoreSnapshot(ctx.projectId, snapshotId);
      await evictProjectPool(ctx.projectId);
      return jsonResult({
        recovered: true,
        toSnapshot: snapshotId,
        tablesAfterRecover: result.restored,
        undo: {
          preRecoverySnapshot: preRecovery.id,
          how: `db_recover with snapshotId:"${preRecovery.id}" returns to the state from just before this recovery.`,
        },
        guidance:
          'recovery done and connections reset. verify your data with the query tool, then re-run your app\'s failing flow.',
      });
    },
  );
}

export function registerDbLifecycleAdminTools(
  server: McpServer,
  ctx: { projectId: string },
  auditCall: (tool: string, metadata: Record<string, unknown>) => Promise<void>,
  jsonResult: (payload: unknown) => { content: { type: 'text'; text: string }[] },
): void {
  server.registerTool(
    'db_reprovision',
    {
      title: 'Reprovision database (DESTROYS EVERYTHING)',
      description:
        'Drop and recreate YOUR project database COMPLETELY EMPTY. Every table, every ' +
        'row, every snapshot and all version history are destroyed — UNRECOVERABLE. ' +
        'Only for a corrupted-beyond-recovery database. Requires confirm:"REPROVISION". ' +
        'Refuses while the database is healthy with tables unless force:true. ' +
        '(Admin-scope keys only.)',
      inputSchema: {
        confirm: z
          .string()
          .describe('Must be exactly "REPROVISION" — proves this is not an accidental call'),
        force: z
          .boolean()
          .optional()
          .describe('Required additionally when the database is still healthy and has tables'),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ confirm, force }) => {
      if (confirm !== 'REPROVISION') {
        throw new Error('refused: confirm must be exactly "REPROVISION" (destroys all data)');
      }
      const health = await checkProjectDbHealth(ctx.projectId);
      if (health.reachable && (health.tableCount ?? 0) > 0 && force !== true) {
        throw new Error(
          `refused: database is healthy with ${health.tableCount} table(s) — a working ` +
            'database should be RECOVERED (db_recover), not reprovisioned. pass force:true ' +
            'only if you truly intend to destroy everything.',
        );
      }
      await auditCall('db_reprovision', { forced: force === true, priorHealth: health });
      await evictProjectPool(ctx.projectId);
      await dropProjectDatabase(ctx.projectId);
      await provisionProjectDatabase(ctx.projectId);
      const after = await checkProjectDbHealth(ctx.projectId);
      return jsonResult({
        reprovisioned: true,
        healthAfter: after,
        guidance:
          'the database is brand new and EMPTY. recreate your tables (create_table or your schema tooling), then repopulate. previous data and snapshots are gone permanently.',
      });
    },
  );
}

/** Tool-name constants — kept in lock-step with mcp-tools.ts scope lists. */
export const DB_LIFECYCLE_READ_TOOLS = ['db_health', 'db_recovery_points'] as const;
export const DB_LIFECYCLE_WRITE_TOOLS = ['db_restart', 'db_recover'] as const;
export const DB_LIFECYCLE_ADMIN_TOOLS = ['db_reprovision'] as const;

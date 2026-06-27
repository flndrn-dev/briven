import {
  diff,
  renderCreateTable,
  type Change,
  type ColumnDef,
  type SchemaDef,
  type TableDef,
} from '@briven/schema';

import { runInProjectDatabase } from '../db/data-plane.js';
import { log } from '../lib/logger.js';

/**
 * Apply a deployment's schema snapshot to the project's data-plane schema.
 *
 * Phase 1 strategy: compute a diff vs. the previous deployment, render
 * each `Change` as a single idempotent SQL statement, run the whole batch
 * in one transaction, then record the deployment id in `_briven_migrations`.
 *
 * Idempotency: every statement uses IF EXISTS / IF NOT EXISTS so retries
 * after a partial failure don't error. Destructive changes (DROP) still
 * commit irreversibly — the dashboard / CLI gate that with
 * `--confirm-destructive` upstream.
 */
export async function applySchema(
  projectId: string,
  deploymentId: string,
  next: SchemaDef,
  prev: SchemaDef | null,
): Promise<{ statements: number }> {
  const result = diff(prev, next);
  const statements = result.changes.flatMap(renderChange);

  await runInProjectDatabase(projectId, async (tx) => {
    for (const stmt of statements) {
      await tx.unsafe(stmt);
    }
    // Bind every value — even though deploymentId is server-generated, raw
    // string interpolation here was a foot-gun if a future caller ever
    // routed user input through.
    await tx.unsafe(
      `INSERT INTO "_briven_migrations" (id, deployment_id, summary)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [deploymentId, deploymentId, JSON.stringify(summarise(result.changes))],
    );
  });

  log.info('schema_applied', {
    projectId,
    deploymentId,
    statements: statements.length,
    changes: result.changes.length,
  });
  return { statements: statements.length };
}

export function renderChange(change: Change): string[] {
  switch (change.kind) {
    case 'create_table':
      return [renderCreateTable(change.table, change.def)];
    case 'drop_table':
      // Order matters: trigger first (depends on table), then function (no
      // longer referenced once the trigger is gone), then the table itself.
      // Without the explicit DROP FUNCTION, the trigger function would
      // orphan in the project schema after every dropped table — invisible
      // bloat that grows monotonically with schema churn.
      return [
        `DROP TRIGGER IF EXISTS ${triggerName(change.table)} ON "${change.table}"`,
        `DROP FUNCTION IF EXISTS ${triggerFnName(change.table)}() CASCADE`,
        `DROP TABLE IF EXISTS "${change.table}" CASCADE`,
      ];
    case 'add_column':
      return [
        `ALTER TABLE "${change.table}" ADD COLUMN IF NOT EXISTS "${change.column}" ${renderColumnType(change.def)}`,
      ];
    case 'drop_column':
      return [`ALTER TABLE "${change.table}" DROP COLUMN IF EXISTS "${change.column}"`];
  }
}

export function singlePkColumn(def: TableDef): string | null {
  const pks = Object.entries(def.columns).filter(([, c]) => c.primaryKey);
  return pks.length === 1 && pks[0] ? pks[0][0] : null;
}

// NOTE: per-table plpgsql NOTIFY triggers were removed (sprint S1.7). Realtime
// detects changes by polling `DOLT_HASHOF('HEAD')` (see apps/realtime), not
// LISTEN/NOTIFY, so emitting these on every create_table was dead work. The
// `drop_table` case still issues idempotent `DROP TRIGGER/FUNCTION IF EXISTS`
// to clean up triggers left behind by projects deployed before this change.

function triggerName(table: string): string {
  return `_briven_notify_${table}`;
}

function triggerFnName(table: string): string {
  return `_briven_notify_${table}_fn`;
}

function renderColumnType(def: ColumnDef): string {
  // DoltGres has no `vector(N)` type; an add_column carrying one (e.g. from a
  // wire snapshot that bypassed the SDK builder) would otherwise emit DDL that
  // crashes DoltGres with a raw `at or near "(": syntax error`. Reject it here
  // with a friendly message before it reaches the data plane. Vector search is
  // coming with LanceDB.
  if (/^vector\b/i.test(def.sqlType)) {
    throw new Error(
      "vector columns aren't supported yet — vector search is coming with LanceDB",
    );
  }
  const parts = [def.sqlType];
  if (!def.nullable && !def.primaryKey) parts.push('NOT NULL');
  if (def.unique && !def.primaryKey) parts.push('UNIQUE');
  if (def.default !== undefined) parts.push(`DEFAULT ${def.default}`);
  return parts.join(' ');
}

function summarise(changes: readonly Change[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of changes) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  return counts;
}

export type { SchemaDef, TableDef };

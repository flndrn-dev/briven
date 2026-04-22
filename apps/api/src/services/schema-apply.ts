import {
  diff,
  renderCreateTable,
  type Change,
  type ColumnDef,
  type SchemaDef,
  type TableDef,
} from '@briven/schema';

import { runInProjectSchema } from '../db/data-plane.js';
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

  await runInProjectSchema(projectId, async (tx) => {
    for (const stmt of statements) {
      await tx.unsafe(stmt);
    }
    await tx.unsafe(`
      INSERT INTO "_briven_migrations" (id, deployment_id, summary)
      VALUES ('${deploymentId}', '${deploymentId}', '${JSON.stringify(summarise(result.changes)).replace(/'/g, "''")}'::jsonb)
      ON CONFLICT (id) DO NOTHING
    `);
  });

  log.info('schema_applied', {
    projectId,
    deploymentId,
    statements: statements.length,
    changes: result.changes.length,
  });
  return { statements: statements.length };
}

function renderChange(change: Change): string[] {
  switch (change.kind) {
    case 'create_table':
      return [renderCreateTable(change.table, change.def)];
    case 'drop_table':
      return [`DROP TABLE IF EXISTS "${change.table}" CASCADE`];
    case 'add_column':
      return [
        `ALTER TABLE "${change.table}" ADD COLUMN IF NOT EXISTS "${change.column}" ${renderColumnType(change.def)}`,
      ];
    case 'drop_column':
      return [`ALTER TABLE "${change.table}" DROP COLUMN IF EXISTS "${change.column}"`];
  }
}

function renderColumnType(def: ColumnDef): string {
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

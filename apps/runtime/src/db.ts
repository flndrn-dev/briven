import postgres from 'postgres';

import { env } from './env.js';

let _client: postgres.Sql | null = null;

function client(): postgres.Sql {
  if (!env.BRIVEN_DATA_PLANE_URL) {
    throw new Error('BRIVEN_DATA_PLANE_URL is not configured on the runtime');
  }
  if (!_client) {
    _client = postgres(env.BRIVEN_DATA_PLANE_URL, {
      max: 20,
      idle_timeout: 30,
      connect_timeout: 5,
      prepare: false,
    });
  }
  return _client;
}

/**
 * Mirror of `apps/api/src/db/data-plane.ts:schemaNameFor` — must stay in
 * sync. Both sides derive the schema name deterministically from the
 * project id so the api never has to ship the schema name in the invoke
 * request payload.
 */
export function schemaNameFor(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  return `proj_${safe}`;
}

export interface DbSession {
  readonly tx: postgres.TransactionSql;
}

/**
 * Open a project-scoped transaction. The first statement sets `search_path`
 * to the project's schema, so unqualified identifiers resolve to its
 * tables. The transaction commits when `fn` resolves; on throw it rolls
 * back automatically.
 */
export async function withProjectTx<T>(
  projectId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const sql = client();
  const schema = schemaNameFor(projectId);
  return sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL search_path TO "${schema}"`);
    return fn(tx);
  }) as Promise<T>;
}

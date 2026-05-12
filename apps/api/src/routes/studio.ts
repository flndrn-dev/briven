import { Hono } from 'hono';

import { projectRateLimit } from '../middleware/rate-limit.js';
import { requireProjectAuth, requireProjectRole } from '../middleware/project-auth.js';
import { audit, hashIp } from '../services/audit.js';
import {
  addColumn,
  createIndex,
  createTable,
  deleteRow,
  dropColumn,
  dropIndex,
  dropTable,
  getTableColumns,
  getTableRows,
  insertRow,
  listIndexes,
  listProjectTables,
  STUDIO_COLUMN_TYPES,
  updateCell,
  type StudioColumnReference,
  type StudioColumnSpec,
  type StudioColumnType,
} from '../services/studio.js';

const FK_ON_DELETE = ['cascade', 'restrict', 'setNull', 'noAction'] as const;
import type { ProjectAppEnv as AppEnv } from '../types/app-env.js';

/**
 * Studio routes — read-mode only. Admin-tier (developer is not enough):
 * the data view surfaces full row contents which could include customer
 * secrets or PII.
 */
export const studioRouter = new Hono<AppEnv>();

studioRouter.use('/v1/projects/:id/studio/*', requireProjectAuth());

studioRouter.get(
  '/v1/projects/:id/studio/tables',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const tables = await listProjectTables(c.req.param('id'));
    return c.json({ tables });
  },
);

studioRouter.get(
  '/v1/projects/:id/studio/tables/:table/columns',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const tableName = c.req.param('table');
    if (!projectId || !tableName) {
      return c.json({ code: 'validation_failed', message: 'missing path params' }, 400);
    }
    const columns = await getTableColumns(projectId, tableName);
    return c.json({ columns });
  },
);

studioRouter.get(
  '/v1/projects/:id/studio/tables/:table/rows',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const tableName = c.req.param('table');
    if (!projectId || !tableName) {
      return c.json({ code: 'validation_failed', message: 'missing path params' }, 400);
    }
    const limit = Number(c.req.query('limit') ?? '50');
    const offset = Number(c.req.query('offset') ?? '0');
    // orderBy: `?orderBy=column&dir=asc|desc`. Both optional; dir defaults
    // to asc. Validated against the actual column set inside the service.
    const orderByCol = c.req.query('orderBy');
    const orderByDir = c.req.query('dir') === 'desc' ? 'desc' : 'asc';
    // filters: every `?col__eq=value` query string. The `__eq` suffix
    // gives us room to add `__lt` / `__like` later without breaking
    // existing callers.
    const filters: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.req.queries())) {
      if (k.endsWith('__eq') && Array.isArray(v) && v[0] !== undefined) {
        filters[k.slice(0, -'__eq'.length)] = v[0];
      }
    }
    const result = await getTableRows(projectId, tableName, {
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
      orderBy: orderByCol ? { column: orderByCol, direction: orderByDir } : null,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
    });
    return c.json(result);
  },
);

/**
 * Inline cell update — write mode for studio. Admin-tier; tier-aware
 * mutate rate limit; every successful write lands an audit-log row
 * recording (table, column, primary-key column, affected count) but
 * never the value itself, per CLAUDE.md §5.1.
 */
studioRouter.patch(
  '/v1/projects/:id/studio/tables/:table/rows',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const tableName = c.req.param('table');
    if (!projectId || !tableName) {
      return c.json({ code: 'validation_failed', message: 'missing path params' }, 400);
    }
    const body = (await c.req.json().catch(() => null)) as {
      primaryKeyColumn?: string;
      primaryKeyValue?: string | number;
      column?: string;
      value?: unknown;
    } | null;
    if (
      !body
      || typeof body.primaryKeyColumn !== 'string'
      || typeof body.column !== 'string'
      || (typeof body.primaryKeyValue !== 'string' && typeof body.primaryKeyValue !== 'number')
    ) {
      return c.json(
        {
          code: 'validation_failed',
          message: 'expected { primaryKeyColumn, primaryKeyValue, column, value }',
        },
        400,
      );
    }
    const result = await updateCell({
      projectId,
      tableName,
      primaryKeyColumn: body.primaryKeyColumn,
      primaryKeyValue: body.primaryKeyValue,
      column: body.column,
      value: body.value,
    });
    const user = c.get('user');
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'studio.cell.update',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: {
        table: tableName,
        column: body.column,
        primaryKeyColumn: body.primaryKeyColumn,
        affected: result.affected,
      },
    });
    return c.json(result);
  },
);

/**
 * Insert a new row. Body: `{ values: { col: value, ... } }`. Returns the
 * inserted row including any DB-side defaults (server-generated ulids,
 * timestamps, etc.).
 */
studioRouter.post(
  '/v1/projects/:id/studio/tables/:table/rows',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const tableName = c.req.param('table');
    if (!projectId || !tableName) {
      return c.json({ code: 'validation_failed', message: 'missing path params' }, 400);
    }
    const body = (await c.req.json().catch(() => null)) as {
      values?: Record<string, unknown>;
    } | null;
    if (!body || !body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
      return c.json(
        { code: 'validation_failed', message: 'expected { values: { col: value, ... } }' },
        400,
      );
    }
    const result = await insertRow({ projectId, tableName, values: body.values });
    const user = c.get('user');
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'studio.row.insert',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: {
        table: tableName,
        // Per CLAUDE.md §5.1 — record the column names that were
        // populated, not the values themselves.
        columns: Object.keys(body.values),
      },
    });
    return c.json(result, 201);
  },
);

/**
 * Delete a row by primary key. Body: `{ primaryKeyColumn, primaryKeyValue }`.
 */
/**
 * Create a new table. Body: `{ tableName, columns: [{ name, type, notNull?,
 * primaryKey?, defaultExpr? }] }`. Service-side validates the type
 * whitelist + identifier shape + at-least-one-pk rule.
 */
function parseColumnSpec(input: unknown): StudioColumnSpec | null {
  if (!input || typeof input !== 'object') return null;
  const c = input as Record<string, unknown>;
  if (typeof c.name !== 'string') return null;
  if (typeof c.type !== 'string') return null;
  if (!(STUDIO_COLUMN_TYPES as readonly string[]).includes(c.type)) return null;

  let references: StudioColumnReference | null | undefined;
  if (c.references === null) {
    references = null;
  } else if (c.references && typeof c.references === 'object') {
    const r = c.references as Record<string, unknown>;
    if (typeof r.table !== 'string' || typeof r.column !== 'string') return null;
    const onDelete =
      typeof r.onDelete === 'string' && (FK_ON_DELETE as readonly string[]).includes(r.onDelete)
        ? (r.onDelete as StudioColumnReference['onDelete'])
        : 'noAction';
    references = { table: r.table, column: r.column, onDelete };
  }

  return {
    name: c.name,
    type: c.type as StudioColumnType,
    notNull: typeof c.notNull === 'boolean' ? c.notNull : undefined,
    primaryKey: typeof c.primaryKey === 'boolean' ? c.primaryKey : undefined,
    defaultExpr:
      typeof c.defaultExpr === 'string' || c.defaultExpr === null
        ? (c.defaultExpr as string | null)
        : undefined,
    references,
  };
}

studioRouter.post(
  '/v1/projects/:id/studio/tables',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const body = (await c.req.json().catch(() => null)) as {
      tableName?: string;
      columns?: unknown[];
    } | null;
    if (!body || typeof body.tableName !== 'string' || !Array.isArray(body.columns)) {
      return c.json(
        { code: 'validation_failed', message: 'expected { tableName, columns: [...] }' },
        400,
      );
    }
    const cols: StudioColumnSpec[] = [];
    for (const raw of body.columns) {
      const spec = parseColumnSpec(raw);
      if (!spec) {
        return c.json(
          { code: 'validation_failed', message: 'each column needs { name, type } at minimum' },
          400,
        );
      }
      cols.push(spec);
    }
    const result = await createTable({ projectId, tableName: body.tableName, columns: cols });
    const user = c.get('user');
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'studio.table.create',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { table: result.name, columnCount: cols.length },
    });
    return c.json(result, 201);
  },
);

studioRouter.delete(
  '/v1/projects/:id/studio/tables/:table',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const tableName = c.req.param('table');
    if (!projectId || !tableName) {
      return c.json({ code: 'validation_failed', message: 'missing path params' }, 400);
    }
    await dropTable(projectId, tableName);
    const user = c.get('user');
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'studio.table.drop',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { table: tableName },
    });
    return c.json({ dropped: tableName });
  },
);

studioRouter.post(
  '/v1/projects/:id/studio/tables/:table/columns',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const tableName = c.req.param('table');
    if (!projectId || !tableName) {
      return c.json({ code: 'validation_failed', message: 'missing path params' }, 400);
    }
    const body = (await c.req.json().catch(() => null)) as { column?: unknown } | null;
    const spec = body ? parseColumnSpec(body.column) : null;
    if (!spec) {
      return c.json(
        { code: 'validation_failed', message: 'expected { column: { name, type, ... } }' },
        400,
      );
    }
    await addColumn({ projectId, tableName, column: spec });
    const user = c.get('user');
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'studio.column.add',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { table: tableName, column: spec.name, type: spec.type },
    });
    return c.json({ added: spec.name }, 201);
  },
);

studioRouter.delete(
  '/v1/projects/:id/studio/tables/:table/columns/:column',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const tableName = c.req.param('table');
    const column = c.req.param('column');
    if (!projectId || !tableName || !column) {
      return c.json({ code: 'validation_failed', message: 'missing path params' }, 400);
    }
    await dropColumn({ projectId, tableName, column });
    const user = c.get('user');
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'studio.column.drop',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { table: tableName, column },
    });
    return c.json({ dropped: column });
  },
);

/**
 * List, create, and drop indexes on a table.
 */
studioRouter.get(
  '/v1/projects/:id/studio/tables/:table/indexes',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const tableName = c.req.param('table');
    if (!projectId || !tableName) {
      return c.json({ code: 'validation_failed', message: 'missing path params' }, 400);
    }
    const indexes = await listIndexes(projectId, tableName);
    return c.json({ indexes });
  },
);

studioRouter.post(
  '/v1/projects/:id/studio/tables/:table/indexes',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const tableName = c.req.param('table');
    if (!projectId || !tableName) {
      return c.json({ code: 'validation_failed', message: 'missing path params' }, 400);
    }
    const body = (await c.req.json().catch(() => null)) as {
      columns?: string[];
      unique?: boolean;
      name?: string | null;
    } | null;
    if (!body || !Array.isArray(body.columns) || body.columns.length === 0) {
      return c.json(
        { code: 'validation_failed', message: 'expected { columns: [...], unique?, name? }' },
        400,
      );
    }
    const cols = body.columns.filter((c) => typeof c === 'string');
    const result = await createIndex({
      projectId,
      tableName,
      columns: cols,
      unique: Boolean(body.unique),
      name: typeof body.name === 'string' ? body.name : null,
    });
    const user = c.get('user');
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'studio.index.create',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: {
        table: tableName,
        index: result.name,
        columns: cols,
        unique: Boolean(body.unique),
      },
    });
    return c.json(result, 201);
  },
);

studioRouter.delete(
  '/v1/projects/:id/studio/tables/:table/indexes/:name',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const tableName = c.req.param('table');
    const indexName = c.req.param('name');
    if (!projectId || !tableName || !indexName) {
      return c.json({ code: 'validation_failed', message: 'missing path params' }, 400);
    }
    await dropIndex(projectId, tableName, indexName);
    const user = c.get('user');
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'studio.index.drop',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { table: tableName, index: indexName },
    });
    return c.json({ dropped: indexName });
  },
);

studioRouter.delete(
  '/v1/projects/:id/studio/tables/:table/rows',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const tableName = c.req.param('table');
    if (!projectId || !tableName) {
      return c.json({ code: 'validation_failed', message: 'missing path params' }, 400);
    }
    const body = (await c.req.json().catch(() => null)) as {
      primaryKeyColumn?: string;
      primaryKeyValue?: string | number;
    } | null;
    if (
      !body
      || typeof body.primaryKeyColumn !== 'string'
      || (typeof body.primaryKeyValue !== 'string' && typeof body.primaryKeyValue !== 'number')
    ) {
      return c.json(
        { code: 'validation_failed', message: 'expected { primaryKeyColumn, primaryKeyValue }' },
        400,
      );
    }
    const result = await deleteRow({
      projectId,
      tableName,
      primaryKeyColumn: body.primaryKeyColumn,
      primaryKeyValue: body.primaryKeyValue,
    });
    const user = c.get('user');
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'studio.row.delete',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: {
        table: tableName,
        primaryKeyColumn: body.primaryKeyColumn,
        affected: result.affected,
      },
    });
    return c.json(result);
  },
);

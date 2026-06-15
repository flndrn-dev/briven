import { Hono } from 'hono';

import { projectRateLimit } from '../middleware/rate-limit.js';
import { requireProjectAuth, requireProjectRole } from '../middleware/project-auth.js';
import { audit, hashIp } from '../services/audit.js';
import { exportProjectSchema } from '../services/schema-export.js';
import {
  addColumn,
  alterColumn,
  createIndex,
  createTable,
  deleteRow,
  dropColumn,
  dropIndex,
  dropTable,
  executeQuery,
  exportSchemaAsDsl,
  getFullSchema,
  getTableColumns,
  getTableRows,
  insertRow,
  listIndexes,
  listProjectTables,
  listRelationships,
  renameColumn,
  renameTable,
  truncateTable,
  STUDIO_COLUMN_TYPES,
  FILTER_OPS,
  updateCell,
  type FilterOp,
  type PrimaryKeyValue,
  type StudioColumnReference,
  type StudioColumnSpec,
  type StudioColumnType,
} from '../services/studio.js';
import { seedTemplate } from '../services/templates.js';
import {
  createSnapshot,
  deleteSnapshot,
  diffSnapshot,
  listSnapshots,
  restoreSnapshot,
  SNAP_ID_RE,
} from '../services/snapshots.js';
import { applyPlan, planDatabase } from '../services/assistant.js';
import { assistantConfigured } from '../services/ollama.js';

/**
 * Shape-validate the `primaryKey` array a client sent. Returns the typed
 * array on success, null on any malformed input — the route then returns
 * a 400 with a clear example. The service layer additionally checks that
 * the column SET matches the table's actual PK; that's not done here so
 * the route doesn't need a db roundtrip to reject obvious garbage.
 */
function parsePrimaryKey(raw: unknown): ReadonlyArray<PrimaryKeyValue> | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: PrimaryKeyValue[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null;
    const e = entry as { column?: unknown; value?: unknown };
    if (typeof e.column !== 'string') return null;
    if (typeof e.value !== 'string' && typeof e.value !== 'number') return null;
    out.push({ column: e.column, value: e.value });
  }
  return out;
}

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
  projectRateLimit('read'),
  requireProjectRole('admin'),
  async (c) => {
    const tables = await listProjectTables(c.req.param('id'));
    return c.json({ tables });
  },
);

/**
 * AI assistant — "describe it and Briven builds it". Powered by flndrn's
 * self-hosted Ollama. Two steps so the user is never surprised:
 *   POST .../assistant/plan   → JSON build plan (writes nothing)
 *   POST .../assistant/apply  → runs the reviewed plan through createTable/insertRow
 * Admin-tier only (it creates tables + data).
 */
studioRouter.post(
  '/v1/projects/:id/studio/assistant/plan',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    if (!assistantConfigured()) {
      return c.json({ code: 'assistant_unconfigured', message: 'the assistant is resting — try again soon' }, 503);
    }
    const body = (await c.req.json().catch(() => null)) as { prompt?: string } | null;
    if (!body || typeof body.prompt !== 'string' || body.prompt.trim() === '') {
      return c.json({ code: 'validation_failed', message: 'expected { prompt: string }' }, 400);
    }
    const plan = await planDatabase(c.req.param('id'), body.prompt.slice(0, 2000));
    return c.json({ plan });
  },
);

studioRouter.post(
  '/v1/projects/:id/studio/assistant/apply',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const body = (await c.req.json().catch(() => null)) as { plan?: unknown } | null;
    if (!body || !body.plan) {
      return c.json({ code: 'validation_failed', message: 'expected { plan }' }, 400);
    }
    const result = await applyPlan(projectId, body.plan);
    const user = c.get('user');
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'studio.assistant.apply',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { created: result.created.map((x) => x.table), skipped: result.skipped },
    });
    return c.json(result);
  },
);

/**
 * Run arbitrary SQL against the project's schema, scoped via SET LOCAL ROLE
 * to the project-owner role so cross-schema access is impossible. Audit-
 * logged so an admin can later replay what was run. Sql text is truncated
 * to 1KB in the audit to keep the table size bounded.
 */
studioRouter.post(
  '/v1/projects/:id/studio/query',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const body = (await c.req.json().catch(() => null)) as { sql?: string } | null;
    if (!body || typeof body.sql !== 'string' || body.sql.trim() === '') {
      return c.json({ code: 'validation_failed', message: 'expected { sql: string }' }, 400);
    }
    try {
      const result = await executeQuery(projectId, body.sql);
      const user = c.get('user');
      await audit({
        actorId: user?.id ?? null,
        projectId,
        action: 'studio.query.run',
        ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
        userAgent: c.req.header('user-agent') ?? null,
        metadata: {
          sqlPreview: body.sql.slice(0, 1024),
          command: result.command,
          rowCount: result.rowCount,
          elapsedMs: result.elapsedMs,
        },
      });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'query failed';
      return c.json({ code: 'query_failed', message }, 400);
    }
  },
);

/**
 * Full one-shot schema: every table with its columns + every FK edge.
 * Drives the studio schema overview page.
 */
studioRouter.get(
  '/v1/projects/:id/studio/schema',
  projectRateLimit('read'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const schema = await getFullSchema(projectId);
    return c.json(schema);
  },
);

/**
 * Every FK edge in the schema. Drives the relationships panel on the
 * studio overview.
 */
studioRouter.get(
  '/v1/projects/:id/studio/relationships',
  projectRateLimit('read'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const edges = await listRelationships(projectId);
    return c.json({ edges });
  },
);

/**
 * JSON-wrapped schema export — returns `{ schemaTs }`. Used by the CLI
 * (`briven pull`) to materialise a local `briven/schema.ts` from the
 * server's current schema. Distinct from the text/plain `schema.ts`
 * endpoint below, which the browser studio uses for direct download.
 */
studioRouter.get(
  '/v1/projects/:id/studio/schema-export',
  projectRateLimit('read'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const schemaTs = await exportProjectSchema(projectId);
    return c.json({ schemaTs });
  },
);

/**
 * Generate an equivalent `briven/schema.ts` for the project — for users
 * who started in studio and want to graduate to git-tracked CLI deploys.
 */
studioRouter.get(
  '/v1/projects/:id/studio/schema.ts',
  projectRateLimit('read'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const body = await exportSchemaAsDsl(projectId);
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
);

studioRouter.get(
  '/v1/projects/:id/studio/tables/:table/columns',
  projectRateLimit('read'),
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
  projectRateLimit('read'),
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
    // filters: `?col__op=value` per Phase 2 §2.3. Op is parsed off the
    // suffix and passed through to the service, which validates against
    // the FILTER_OPS allow-list. Unknown ops are silently dropped at the
    // route layer; the service raises ValidationError for unknown columns,
    // which the router converts to 400 upstream.
    const filters: Array<{ column: string; op: FilterOp; value: string }> = [];
    for (const [k, v] of Object.entries(c.req.queries())) {
      const sepAt = k.lastIndexOf('__');
      if (sepAt <= 0) continue;
      const col = k.slice(0, sepAt);
      const op = k.slice(sepAt + 2);
      if (!(FILTER_OPS as readonly string[]).includes(op)) continue;
      if (!Array.isArray(v) || v[0] === undefined) continue;
      filters.push({ column: col, op: op as FilterOp, value: v[0] });
    }
    const result = await getTableRows(projectId, tableName, {
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
      orderBy: orderByCol ? { column: orderByCol, direction: orderByDir } : null,
      filters: filters.length > 0 ? filters : undefined,
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
      primaryKey?: Array<{ column?: unknown; value?: unknown }>;
      column?: string;
      value?: unknown;
    } | null;
    const primaryKey = parsePrimaryKey(body?.primaryKey);
    if (!body || typeof body.column !== 'string' || !primaryKey) {
      return c.json(
        {
          code: 'validation_failed',
          message:
            'expected { primaryKey: [{column, value}, ...], column, value } — primaryKey must be a non-empty array of {column: string, value: string | number}',
        },
        400,
      );
    }
    const result = await updateCell({
      projectId,
      tableName,
      primaryKey,
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
        primaryKeyColumns: primaryKey.map((p) => p.column),
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

/**
 * Apply a starter template to a (freshly created, empty) project: creates the
 * template's tables in FK order and seeds sample rows, so a non-coder lands on
 * a working database instead of a blank screen. Body: `{ templateId }`.
 */
studioRouter.post(
  '/v1/projects/:id/studio/apply-template',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const body = (await c.req.json().catch(() => null)) as { templateId?: string } | null;
    if (!body || typeof body.templateId !== 'string') {
      return c.json({ code: 'validation_failed', message: 'expected { templateId }' }, 400);
    }
    const result = await seedTemplate(projectId, body.templateId);
    const user = c.get('user');
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'studio.template.apply',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: {
        templateId: result.templateId,
        tablesCreated: result.tablesCreated,
        rowsInserted: result.rowsInserted,
      },
    });
    return c.json(result, 201);
  },
);

/**
 * Snapshots — the non-coder "undo button" (lite git-for-data on Postgres).
 * Save / list / restore / delete point-in-time copies of a project's data.
 */
studioRouter.get(
  '/v1/projects/:id/studio/snapshots',
  projectRateLimit('read'),
  requireProjectRole('admin'),
  async (c) => {
    const snapshots = await listSnapshots(c.req.param('id'));
    return c.json({ snapshots });
  },
);

studioRouter.post(
  '/v1/projects/:id/studio/snapshots',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const body = (await c.req.json().catch(() => null)) as { name?: string } | null;
    const result = await createSnapshot(projectId, body?.name ?? 'snapshot');
    const user = c.get('user');
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'studio.snapshot.create',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { snapshotId: result.id, tableCount: result.tableCount },
    });
    return c.json(result, 201);
  },
);

/**
 * Snapshot diff — "what changed since this save point". Read-only: compares
 * the live schema against the snapshot's copy and reports tables/columns
 * added or removed plus per-table row deltas (added/removed/changed, matched
 * by primary key, capped per table). Drives the dashboard "compare" view.
 */
studioRouter.get(
  '/v1/projects/:id/studio/snapshots/:snapId/diff',
  projectRateLimit('read'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const snapId = c.req.param('snapId');
    if (!SNAP_ID_RE.test(snapId)) {
      return c.json({ code: 'validation_failed', message: 'invalid snapshot id' }, 400);
    }
    const diff = await diffSnapshot(projectId, snapId);
    const user = c.get('user');
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'studio.snapshot.diff',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: {
        snapshotId: snapId,
        tablesAdded: diff.tablesAdded.length,
        tablesRemoved: diff.tablesRemoved.length,
        tablesCompared: diff.tables.length,
      },
    });
    return c.json(diff);
  },
);

studioRouter.post(
  '/v1/projects/:id/studio/snapshots/:snapId/restore',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const snapId = c.req.param('snapId');
    const result = await restoreSnapshot(projectId, snapId);
    const user = c.get('user');
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'studio.snapshot.restore',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { snapshotId: snapId, restored: result.restored },
    });
    return c.json(result);
  },
);

studioRouter.delete(
  '/v1/projects/:id/studio/snapshots/:snapId',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const snapId = c.req.param('snapId');
    await deleteSnapshot(projectId, snapId);
    const user = c.get('user');
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'studio.snapshot.delete',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { snapshotId: snapId },
    });
    return c.json({ ok: true });
  },
);

studioRouter.patch(
  '/v1/projects/:id/studio/tables/:table',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const tableName = c.req.param('table');
    if (!projectId || !tableName) {
      return c.json({ code: 'validation_failed', message: 'missing path params' }, 400);
    }
    const body = (await c.req.json().catch(() => null)) as { newName?: string } | null;
    if (!body || typeof body.newName !== 'string') {
      return c.json({ code: 'validation_failed', message: 'expected { newName: string }' }, 400);
    }
    await renameTable({ projectId, oldName: tableName, newName: body.newName });
    const user = c.get('user');
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'studio.table.rename',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { oldName: tableName, newName: body.newName },
    });
    return c.json({ renamed: body.newName });
  },
);

studioRouter.patch(
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
    const body = (await c.req.json().catch(() => null)) as {
      newName?: string;
      notNull?: boolean;
      defaultExpr?: string | null;
    } | null;
    if (!body) {
      return c.json({ code: 'validation_failed', message: 'body required' }, 400);
    }
    // Two-mode patch: rename (newName) OR alter (notNull, defaultExpr).
    // Mutually exclusive so audit metadata stays clean.
    if (typeof body.newName === 'string') {
      await renameColumn({
        projectId,
        tableName,
        oldName: column,
        newName: body.newName,
      });
      const user = c.get('user');
      await audit({
        actorId: user?.id ?? null,
        projectId,
        action: 'studio.column.rename',
        ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
        userAgent: c.req.header('user-agent') ?? null,
        metadata: { table: tableName, oldName: column, newName: body.newName },
      });
      return c.json({ renamed: body.newName });
    }
    if (typeof body.notNull === 'boolean' || body.defaultExpr !== undefined) {
      await alterColumn({
        projectId,
        tableName,
        column,
        notNull: typeof body.notNull === 'boolean' ? body.notNull : undefined,
        defaultExpr:
          body.defaultExpr === null
            ? null
            : typeof body.defaultExpr === 'string'
              ? body.defaultExpr
              : undefined,
      });
      const user = c.get('user');
      await audit({
        actorId: user?.id ?? null,
        projectId,
        action: 'studio.column.alter',
        ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
        userAgent: c.req.header('user-agent') ?? null,
        metadata: {
          table: tableName,
          column,
          notNull: typeof body.notNull === 'boolean' ? body.notNull : null,
          defaultExpr:
            body.defaultExpr === null
              ? '(dropped)'
              : typeof body.defaultExpr === 'string'
                ? body.defaultExpr
                : null,
        },
      });
      return c.json({ altered: column });
    }
    return c.json(
      {
        code: 'validation_failed',
        message: 'expected { newName } or { notNull?, defaultExpr? }',
      },
      400,
    );
  },
);

studioRouter.post(
  '/v1/projects/:id/studio/tables/:table/truncate',
  projectRateLimit('mutate'),
  requireProjectRole('admin'),
  async (c) => {
    const projectId = c.req.param('id');
    const tableName = c.req.param('table');
    if (!projectId || !tableName) {
      return c.json({ code: 'validation_failed', message: 'missing path params' }, 400);
    }
    const body = (await c.req.json().catch(() => null)) as { cascade?: boolean } | null;
    await truncateTable(projectId, tableName, Boolean(body?.cascade));
    const user = c.get('user');
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'studio.table.truncate',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: { table: tableName, cascade: Boolean(body?.cascade) },
    });
    return c.json({ truncated: tableName });
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
  projectRateLimit('read'),
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
      primaryKey?: Array<{ column?: unknown; value?: unknown }>;
    } | null;
    const primaryKey = parsePrimaryKey(body?.primaryKey);
    if (!primaryKey) {
      return c.json(
        {
          code: 'validation_failed',
          message:
            'expected { primaryKey: [{column, value}, ...] } — primaryKey must be a non-empty array of {column: string, value: string | number}',
        },
        400,
      );
    }
    const result = await deleteRow({ projectId, tableName, primaryKey });
    const user = c.get('user');
    await audit({
      actorId: user?.id ?? null,
      projectId,
      action: 'studio.row.delete',
      ipHash: hashIp(c.req.raw.headers.get('cf-connecting-ip') ?? null),
      userAgent: c.req.header('user-agent') ?? null,
      metadata: {
        table: tableName,
        primaryKeyColumns: primaryKey.map((p) => p.column),
        affected: result.affected,
      },
    });
    return c.json(result);
  },
);

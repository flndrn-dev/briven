import { Hono } from "hono";

import { projectRateLimit } from "../middleware/rate-limit.js";
import { requireProjectAuth, requireProjectRole } from "../middleware/project-auth.js";
import type { ProjectAppEnv as AppEnv } from "../types/app-env.js";
import {
  listProjectTables,
  getFullSchema,
  executeQuery,
  getTableColumns,
  getTableRows,
  insertRow,
  deleteRow,
  updateCell,
  listRelationships,
  createTable,
  dropTable,
} from "../services/studio.js";
import type { StudioColumnSpec } from "../services/studio.js";
import { audit, hashIp } from "../services/audit.js";
import { log } from "../lib/logger.js";

/**
 * /platform/* proxy — Supabase-Studio-compatible API surface.
 *
 * Studio's generated API types expect paths like
 *   /platform/pg-meta/{ref}/tables
 *   /platform/auth/{ref}/config
 *   /platform/rest/v1/{ref}/{table}
 *
 * These routes map the Supabase-style paths to briven's internal
 * studio service. Auth is enforced via requireProjectAuth + requireProjectRole
 * (same middleware as the /v1/projects/:id/studio/* routes).
 *
 * Unknown /platform/* paths return 404 with a logged warning so we can add
 * mappings as needed.
 */

const platformRouter = new Hono<AppEnv>();

// Auth for all platform routes — session cookie from .briven.tech
platformRouter.use("/platform/*", requireProjectAuth());

// ── pg-meta (schema introspection) ──────────────────────────────────────

platformRouter.get(
  "/platform/pg-meta/:ref/tables",
  projectRateLimit("mutate"),
  requireProjectRole("admin"),
  async (c) => {
    const tables = await listProjectTables(c.req.param("ref"));
    return c.json(tables);
  }
);

platformRouter.get(
  "/platform/pg-meta/:ref/schemas",
  projectRateLimit("mutate"),
  requireProjectRole("admin"),
  async (c) => {
    const schema = await getFullSchema(c.req.param("ref"));
    return c.json(schema);
  }
);

platformRouter.get(
  "/platform/pg-meta/:ref/foreign-tables",
  projectRateLimit("mutate"),
  requireProjectRole("admin"),
  async (c) => {
    // Return relationships as foreign-table info
    const rels = await listRelationships(c.req.param("ref"));
    return c.json(rels);
  }
);

platformRouter.post(
  "/platform/pg-meta/:ref/query",
  projectRateLimit("mutate"),
  requireProjectRole("admin"),
  async (c) => {
    const projectId = c.req.param("ref");
    const body = (await c.req.json().catch(() => null)) as { sql?: string } | null;
    if (!body || typeof body.sql !== "string" || body.sql.trim() === "") {
      return c.json({ code: "validation_failed", message: "expected { sql: string }" }, 400);
    }
    try {
      const result = await executeQuery(projectId, body.sql);
      const user = c.get("user");
      await audit({
        actorId: user?.id ?? null,
        projectId,
        action: "studio.query.run",
        ipHash: hashIp(c.req.raw.headers.get("cf-connecting-ip") ?? null),
        userAgent: c.req.header("user-agent") ?? null,
        metadata: { sqlPreview: body.sql.slice(0, 1024), elapsedMs: result.elapsedMs },
      });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "query failed";
      return c.json({ code: "query_failed", message }, 400);
    }
  }
);

// ── Table columns ───────────────────────────────────────────────────────

platformRouter.get(
  "/platform/pg-meta/:ref/columns",
  projectRateLimit("mutate"),
  requireProjectRole("admin"),
  async (c) => {
    const projectId = c.req.param("ref");
    const tableName = c.req.query("table");
    if (!tableName) {
      return c.json({ code: "validation_failed", message: "?table= required" }, 400);
    }
    const columns = await getTableColumns(projectId, tableName);
    return c.json(columns);
  }
);

// ── Row CRUD (mapped from /platform/rest/v1) ────────────────────────────

platformRouter.get(
  "/platform/rest/v1/:ref/:table",
  projectRateLimit("mutate"),
  requireProjectRole("admin"),
  async (c) => {
    const projectId = c.req.param("ref");
    const tableName = c.req.param("table");
    const limit = Number(c.req.query("limit") || "100");
    const offset = Number(c.req.query("offset") || "0");
    const rows = await getTableRows(projectId, tableName, { limit, offset });
    return c.json(rows);
  }
);

platformRouter.post(
  "/platform/rest/v1/:ref/:table",
  projectRateLimit("mutate"),
  requireProjectRole("admin"),
  async (c) => {
    const projectId = c.req.param("ref");
    const tableName = c.req.param("table");
    const body = await c.req.json<Record<string, unknown>>();
    const result = await insertRow({ projectId, tableName, values: body });
    return c.json(result, 201);
  }
);

platformRouter.patch(
  "/platform/rest/v1/:ref/:table",
  projectRateLimit("mutate"),
  requireProjectRole("admin"),
  async (c) => {
    const projectId = c.req.param("ref");
    const tableName = c.req.param("table");
    const body = await c.req.json<{ primaryKey: Array<{ column: string; value: string | number }>; values: Record<string, unknown> }>();
    if (!body.primaryKey || !body.values) {
      return c.json({ code: "validation_failed", message: "expected { primaryKey, values }" }, 400);
    }
    // Postgres updateCell sets one column at a time; apply each value in the patch.
    for (const [column, value] of Object.entries(body.values)) {
      await updateCell({ projectId, tableName, primaryKey: body.primaryKey, column, value });
    }
    return c.json({ ok: true });
  }
);

platformRouter.delete(
  "/platform/rest/v1/:ref/:table",
  projectRateLimit("mutate"),
  requireProjectRole("admin"),
  async (c) => {
    const projectId = c.req.param("ref");
    const tableName = c.req.param("table");
    const body = await c.req.json<{ primaryKey: Array<{ column: string; value: string | number }> }>();
    if (!body.primaryKey) {
      return c.json({ code: "validation_failed", message: "expected { primaryKey }" }, 400);
    }
    await deleteRow({ projectId, tableName, primaryKey: body.primaryKey });
    return c.json({ ok: true });
  }
);

// ── Table create/drop ───────────────────────────────────────────────────

platformRouter.post(
  "/platform/pg-meta/:ref/tables",
  projectRateLimit("mutate"),
  requireProjectRole("admin"),
  async (c) => {
    const projectId = c.req.param("ref");
    const body = await c.req.json<{ name: string; schema?: string; comment?: string; columns?: StudioColumnSpec[] }>();
    if (!body.name) {
      return c.json({ code: "validation_failed", message: "expected { name }" }, 400);
    }
    // Postgres requires at least one column + a primary key; default to a
    // uuid `id` PK when the caller didn't specify columns.
    const columns: StudioColumnSpec[] =
      body.columns && body.columns.length > 0
        ? body.columns
        : [{ name: "id", type: "uuid", primaryKey: true, notNull: true, defaultExpr: "gen_random_uuid()" }];
    await createTable({ projectId, tableName: body.name, columns });
    return c.json({ name: body.name }, 201);
  }
);

platformRouter.delete(
  "/platform/pg-meta/:ref/tables/:id",
  projectRateLimit("mutate"),
  requireProjectRole("admin"),
  async (c) => {
    const projectId = c.req.param("ref");
    const tableName = c.req.param("id");
    await dropTable(projectId, tableName);
    return c.json({ ok: true });
  }
);

// ── Catch-all for unmapped /platform/* paths ───────────────────────────

platformRouter.all("/platform/*", async (c) => {
  log.warn("platform_unmapped", {
    method: c.req.method,
    path: c.req.path,
  });
  return c.json(
    {
      code: "platform_not_implemented",
      message: `No briven handler for ${c.req.method} ${c.req.path}`,
    },
    404
  );
});

export { platformRouter };

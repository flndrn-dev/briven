import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { runInProjectDatabase } from '../db/data-plane.js';
import type { McpKeyScope } from '../db/schema.js';
import { env } from '../env.js';
import { audit } from './audit.js';
import { AUTH_BRIDGE_TOOLS, registerAuthBridgeTools } from './mcp-auth-bridge.js';
import { BRIVEN_ASK_TOOLS, registerBrivenAskTool } from './mcp-briven-ask.js';
import {
  DB_LIFECYCLE_ADMIN_TOOLS,
  DB_LIFECYCLE_READ_TOOLS,
  DB_LIFECYCLE_WRITE_TOOLS,
  registerDbLifecycleAdminTools,
  registerDbLifecycleReadTools,
  registerDbLifecycleWriteTools,
} from './mcp-db-lifecycle.js';
import { signedTransformUrl, isImageTransformConfigured } from './image-transform.js';
import {
  deleteFile,
  listFiles,
  presignDownload,
  presignUpload,
  setFilePublic,
} from './storage.js';
import { createStorageKey, listStorageKeys, revokeStorageKey } from './storage-keys.js';
import {
  createGrant,
  isGranted,
  listGrants,
  revokeGrant,
} from './storage-grants.js';
import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
} from './storage-share-links.js';
import {
  STUDIO_COLUMN_TYPES,
  createTable,
  getTableColumns,
  insertRow,
  listProjectTables,
} from './studio.js';
import { TIERS, getProjectTier } from './tiers.js';

/**
 * B Phase 5 / mcp.briven.tech — the MCP tool set.
 *
 * THE ISOLATION CONTRACT (must never bend):
 *   - NO tool accepts a `projectId` argument. Every tool derives the project
 *     id ONLY from the verified key binding (`McpToolContext.projectId`) and
 *     runs through `runInProjectDatabase(boundProjectId, …)`, which opens a
 *     connection bound to that one project's DoltGres database. An agent can
 *     therefore never reach another project's data, whatever it sends.
 *   - A read-only key never even SEES the write tools: create_table/insert/
 *     update/delete are only REGISTERED when scope ∈ {read-write, admin}, so
 *     they are absent from `tools/list` for a `read` key.
 *   - Every `tools/call` is audited under the `mcp.*` prefix (actor = keyId,
 *     project = bound projectId). Row values are never written to the audit log.
 *
 * The read tools mirror the Studio service's already-proven DoltGres-safe read
 * path (table listing, column introspection) rather than inventing new SQL
 * handling; the write tools reuse / mirror the same validated-identifier +
 * parameterised-value discipline.
 */

/** The verified, immutable binding a built server closes over. */
export interface McpToolContext {
  readonly keyId: string;
  readonly projectId: string;
  readonly scope: McpKeyScope;
  readonly ipHash: string | null;
  readonly userAgent: string | null;
}

/** Same identifier rule Studio enforces — blocks SQL-injection via column names. */
const COLUMN_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/** Hard cap on rows a single `query` call returns, so a huge table can't OOM. */
const QUERY_ROW_CAP = 1000;

/**
 * Read-only guard for the `query` tool. Only a single SELECT/WITH statement is
 * allowed; any DML/DDL keyword or a second statement is refused. This is the
 * real defence — the tool deliberately does NOT issue `SET dolt_transaction_commit`,
 * but the keyword gate is what stops a data-modifying CTE from ever running.
 */
const READONLY_LEAD_RE = /^\s*(select|with)\b/i;
const FORBIDDEN_KEYWORD_RE =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|merge|replace)\b/i;

export function assertReadOnlyQuery(sql: string): string {
  if (typeof sql !== 'string' || sql.trim() === '') {
    throw new Error('sql is required');
  }
  if (sql.length > 16 * 1024) {
    throw new Error('sql payload too large');
  }
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (trimmed.includes(';')) {
    throw new Error('only a single statement is allowed');
  }
  if (!READONLY_LEAD_RE.test(trimmed)) {
    throw new Error('only read-only SELECT / WITH queries are allowed');
  }
  if (FORBIDDEN_KEYWORD_RE.test(trimmed)) {
    throw new Error('query contains a forbidden (write) keyword');
  }
  return trimmed;
}

/** Turn any tool payload into the MCP text-content result shape. */
function jsonResult(payload: unknown): {
  content: { type: 'text'; text: string }[];
} {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

/** Validate a column→value map against the table's real columns; return the keys. */
async function validatedColumns(
  projectId: string,
  table: string,
  values: Record<string, unknown>,
  label: string,
): Promise<string[]> {
  // getTableColumns also asserts the table exists in THIS project and refuses
  // the platform-owned `_briven_*` tables — so it doubles as the existence gate.
  const cols = await getTableColumns(projectId, table);
  const colNames = new Set(cols.map((c) => c.name));
  const keys = Object.keys(values);
  if (keys.length === 0) {
    throw new Error(`${label} requires at least one column`);
  }
  for (const k of keys) {
    if (!COLUMN_NAME_RE.test(k)) throw new Error(`invalid column name: ${k}`);
    if (!colNames.has(k)) throw new Error(`column not found on table: ${k}`);
  }
  return keys;
}

/** Parameterised UPDATE bound to the project's own database. */
async function runUpdate(
  projectId: string,
  table: string,
  match: Record<string, unknown>,
  set: Record<string, unknown>,
): Promise<number> {
  const setKeys = await validatedColumns(projectId, table, set, 'update set');
  const matchKeys = await validatedColumns(projectId, table, match, 'update match');
  // Refuse an unbounded UPDATE — a missing match would rewrite every row.
  const params: unknown[] = [];
  const setSql = setKeys
    .map((k) => {
      params.push(set[k]);
      return `"${k}" = $${params.length}`;
    })
    .join(', ');
  const whereSql = matchKeys
    .map((k) => {
      params.push(match[k]);
      return `"${k}" = $${params.length}`;
    })
    .join(' AND ');
  const rows = await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe('SET dolt_transaction_commit = 1');
    return tx.unsafe(
      // RETURNING * (real columns), NOT `RETURNING 1` — DoltGres rejects a bare
      // integer literal in RETURNING and throws, which silently failed writes.
      `UPDATE "${table}" SET ${setSql} WHERE ${whereSql} RETURNING *`,
      params,
    );
  });
  return rows.length;
}

/** Parameterised DELETE bound to the project's own database. */
async function runDelete(
  projectId: string,
  table: string,
  match: Record<string, unknown>,
): Promise<number> {
  const matchKeys = await validatedColumns(projectId, table, match, 'delete match');
  // Refuse an unbounded DELETE — `validatedColumns` already requires ≥1 key.
  const params: unknown[] = [];
  const whereSql = matchKeys
    .map((k) => {
      params.push(match[k]);
      return `"${k}" = $${params.length}`;
    })
    .join(' AND ');
  const rows = await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe('SET dolt_transaction_commit = 1');
    return tx.unsafe(`DELETE FROM "${table}" WHERE ${whereSql} RETURNING *`, params);
  });
  return rows.length;
}

/**
 * Build a fresh `McpServer` hard-bound to one verified key's project + scope.
 * One server is created per request in the stateless transport model, so the
 * binding can never leak across keys / sessions.
 */
export function buildMcpServer(ctx: McpToolContext): McpServer {
  const server = new McpServer(
    { name: 'briven-mcp', version: '1.0.0' },
    {
      instructions:
        'Briven data-plane access. Every tool operates ONLY on the single ' +
        'project this key is bound to; you cannot select another project. ' +
        'The auth_* and sender_domain_status tools additionally answer auth / ' +
        'sign-in-email configuration questions with read-only facts plus ' +
        '"apply in your project" guidance and docs citations. For ANY other ' +
        'briven question (database, storage, functions, realtime, limits, ' +
        'migration, hosting), ask briven_ask FIRST — it always answers with ' +
        'the platform picture, the available primitives, and the part you ' +
        'build in your own project; unmatched questions are filed for the ' +
        'platform team, never dead-ended.',
    },
  );

  // Audit helper — actor is the keyId, project is the bound project id. Never
  // logs row values, only the tool name + table touched.
  const auditCall = (tool: string, metadata: Record<string, unknown>): Promise<void> =>
    audit({
      actorId: ctx.keyId,
      projectId: ctx.projectId,
      action: `mcp.tool.${tool}`,
      ipHash: ctx.ipHash,
      userAgent: ctx.userAgent,
      metadata: { ...metadata, keyId: ctx.keyId, scope: ctx.scope },
    });

  /* ── read tools — available to EVERY key (read, read-write, admin) ──── */

  server.registerTool(
    'list_tables',
    {
      title: 'List tables',
      description:
        'List the tables in your project database (name, approx row count, size). ' +
        'Platform-owned tables are hidden.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      await auditCall('list_tables', {});
      const tables = await listProjectTables(ctx.projectId);
      return jsonResult({ tables });
    },
  );

  server.registerTool(
    'describe_table',
    {
      title: 'Describe a table',
      description:
        'Return the columns of one table (name, type, nullability, default, ' +
        'primary key, foreign-key references).',
      inputSchema: { table: z.string().describe('Table name in your project') },
      annotations: { readOnlyHint: true },
    },
    async ({ table }) => {
      await auditCall('describe_table', { table });
      const columns = await getTableColumns(ctx.projectId, table);
      return jsonResult({ table, columns });
    },
  );

  server.registerTool(
    'query',
    {
      title: 'Run a read-only query',
      description:
        'Run a single read-only SELECT (or WITH … SELECT) statement against your ' +
        `project database. Writes are rejected. At most ${QUERY_ROW_CAP} rows are returned.`,
      inputSchema: { sql: z.string().describe('A single read-only SELECT/WITH statement') },
      annotations: { readOnlyHint: true },
    },
    async ({ sql }) => {
      const safeSql = assertReadOnlyQuery(sql);
      await auditCall('query', { length: safeSql.length });
      const rows = (await runInProjectDatabase(ctx.projectId, async (tx) =>
        tx.unsafe(safeSql),
      )) as Array<Record<string, unknown>>;
      const truncated = rows.length > QUERY_ROW_CAP;
      return jsonResult({
        rowCount: Math.min(rows.length, QUERY_ROW_CAP),
        truncated,
        rows: truncated ? rows.slice(0, QUERY_ROW_CAP) : rows,
      });
    },
  );

  /* ── storage tools — per-project object storage, bound to this key ──── */

  server.registerTool(
    'storage_list_files',
    {
      title: 'List storage files',
      description:
        'List the files in your project storage (id, name, content type, size, ' +
        'timestamps). Deleted files are excluded.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      await auditCall('storage_list_files', {});
      const files = await listFiles(ctx.projectId);
      return jsonResult({ files });
    },
  );

  server.registerTool(
    'storage_usage',
    {
      title: 'Storage usage',
      description:
        'Report your project storage usage: bytes used, file count, tier, and the ' +
        'tier byte cap.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      await auditCall('storage_usage', {});
      const files = await listFiles(ctx.projectId);
      const usedBytes = files.reduce((sum, f) => sum + Number(f.sizeBytes), 0);
      const fileCount = files.length;
      const tier = (await getProjectTier(ctx.projectId)) ?? 'free';
      const capBytes = TIERS[tier].storageBytes;
      return jsonResult({ usedBytes, capBytes, fileCount, tier });
    },
  );

  server.registerTool(
    'storage_upload_url',
    {
      title: 'Get an upload URL',
      description:
        'Reserve a file and get a presigned upload URL. You then PUT the raw bytes ' +
        'directly to `uploadUrl`, sending every header in `requiredHeaders` — the ' +
        'bytes never pass through this tool. The URL expires after `expiresInSec`.',
      inputSchema: {
        name: z.string().describe('File name (no forward slash)'),
        contentType: z.string().describe("MIME type, e.g. 'image/png'"),
        sizeBytes: z.number().describe('Exact byte size of the file you will upload'),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ name, contentType, sizeBytes }) => {
      await auditCall('storage_upload_url', { name });
      const result = await presignUpload({
        projectId: ctx.projectId,
        name,
        contentType,
        sizeBytes,
        uploadedBy: null,
      });
      return jsonResult({
        fileId: result.file.id,
        uploadUrl: result.uploadUrl,
        requiredHeaders: result.requiredHeaders,
        expiresInSec: result.expiresInSec,
      });
    },
  );

  server.registerTool(
    'storage_download_url',
    {
      title: 'Get a download URL',
      description:
        'Get a presigned download URL for one of your project files. Fetch the bytes ' +
        'directly from `downloadUrl`; it expires after `expiresInSec`.',
      inputSchema: { fileId: z.string().describe('File id in your project') },
      annotations: { readOnlyHint: true },
    },
    async ({ fileId }) => {
      await auditCall('storage_download_url', { fileId });
      const result = await presignDownload(fileId, ctx.projectId);
      return jsonResult({
        downloadUrl: result.downloadUrl,
        expiresInSec: result.expiresInSec,
      });
    },
  );

  server.registerTool(
    'storage_delete_file',
    {
      title: 'Delete a storage file',
      description:
        'Delete one file from your project storage. Returns the deleted file id.',
      inputSchema: { fileId: z.string().describe('File id in your project') },
      annotations: { readOnlyHint: false },
    },
    async ({ fileId }) => {
      await auditCall('storage_delete_file', { fileId });
      await deleteFile(fileId, ctx.projectId);
      return jsonResult({ deleted: true, fileId });
    },
  );

  server.registerTool(
    'storage_make_public',
    {
      title: 'Make a file public or private',
      description:
        'Flip a file between public and private serving. When public, it is served ' +
        'at the returned `url`; when private, `url` is null.',
      inputSchema: {
        fileId: z.string().describe('File id in your project'),
        public: z.boolean().describe('true = publicly served, false = private'),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ fileId, public: publicFlag }) => {
      await auditCall('storage_make_public', { fileId, public: publicFlag });
      await setFilePublic(fileId, ctx.projectId, publicFlag);
      return jsonResult({
        fileId,
        public: publicFlag,
        url: publicFlag
          ? `https://media.briven.tech/media/${ctx.projectId}/${fileId}`
          : null,
      });
    },
  );

  server.registerTool(
    'storage_mint_key',
    {
      title: 'Mint an S3 storage key',
      description:
        'Mint a bucket-scoped S3 access key for your project storage, usable in any ' +
        'S3 tool. The secret is shown only once — save it now.',
      inputSchema: { name: z.string().describe('A label for this key') },
      annotations: { readOnlyHint: false },
    },
    async ({ name }) => {
      await auditCall('storage_mint_key', { name });
      const result = await createStorageKey({
        projectId: ctx.projectId,
        name,
        createdBy: null,
        publicEndpoint: env.BRIVEN_MINIO_PUBLIC_ENDPOINT ?? '',
      });
      return jsonResult({
        accessKey: result.accessKey,
        secretKey: result.secretKey,
        endpoint: result.endpoint,
        bucket: result.bucket,
        note: 'the secret is shown only once',
      });
    },
  );

  /* ── storage: list the project's minted S3 keys (read) ─────────────── */

  server.registerTool(
    'storage_list_keys',
    {
      title: 'List storage keys',
      description:
        'List the bucket-scoped S3 access keys minted for your project (id, name, ' +
        'access key id, bucket, enabled, timestamps). Secrets are never shown.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      await auditCall('storage_list_keys', {});
      const keys = await listStorageKeys(ctx.projectId);
      return jsonResult({ keys });
    },
  );

  /* ── storage: transform URL for a PUBLIC image (read, stateless) ────── */

  server.registerTool(
    'storage_transform_url',
    {
      title: 'Get an image transform URL',
      description:
        'Build a signed on-the-fly image-resize URL for a PUBLIC file in your ' +
        'project. Returns a `url`; requires image transforms to be enabled on the api.',
      inputSchema: {
        fileId: z.string().describe('File id in your project (must be public to serve)'),
        width: z.number().int().optional().describe('Target width in px (optional)'),
        height: z.number().int().optional().describe('Target height in px (optional)'),
        resize: z
          .enum(['fit', 'fill', 'auto'])
          .optional()
          .describe("Resize mode (default 'fit')"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ fileId, width, height, resize }) => {
      await auditCall('storage_transform_url', { fileId });
      if (!isImageTransformConfigured()) {
        throw new Error('image transforms are not enabled on this api');
      }
      const url = signedTransformUrl(ctx.projectId, fileId, { width, height, resize });
      return jsonResult({ url });
    },
  );

  /* ── cross-project sharing (M5): list grants the caller has CREATED ─── */

  server.registerTool(
    'storage_list_grants',
    {
      title: 'List storage grants',
      description:
        'List the cross-project sharing grants YOUR project has created (as the ' +
        'granter): grantee project, resource, prefix flag, created/revoked times.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      await auditCall('storage_list_grants', {});
      const grants = await listGrants(ctx.projectId);
      return jsonResult({ grants });
    },
  );

  /* ── public share-links (M5): list the links YOUR project has minted ──
   * A read — available to every key scope. Returns each link's id, file, url,
   * expiry, and revoked state so the owner can manage them. */

  server.registerTool(
    'storage_list_links',
    {
      title: 'List public share-links',
      description:
        'List the tokenized public share-links YOUR project has minted: id, file ' +
        'id, url, expiry, created/revoked times. Anyone with an active link URL can ' +
        'download that one file until it expires or you revoke it.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      await auditCall('storage_list_links', {});
      const links = await listShareLinks(ctx.projectId);
      return jsonResult({ links });
    },
  );

  /* ── cross-project READ (M5): mint a download URL for a SHARED file ───
   * The ONLY sanctioned cross-project read. Gated by isGranted(caller, granter,
   * fileId) — strict-deny returns a clear `forbidden` error otherwise. This is a
   * read, so it is available to every key scope. */

  server.registerTool(
    'storage_shared_download_url',
    {
      title: 'Download a file shared with you',
      description:
        'Get a presigned download URL for a file that ANOTHER project has granted ' +
        'to you. Provide the granter project id + the file id. If no active grant ' +
        'covers that file, returns a `forbidden` error — you cannot read anything ' +
        'that was not explicitly shared.',
      inputSchema: {
        granterProjectId: z.string().describe('The project that owns + shared the file'),
        fileId: z.string().describe('The shared file id (owned by the granter project)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ granterProjectId, fileId }) => {
      const allowed = await isGranted(ctx.projectId, granterProjectId, fileId);
      await auditCall('storage.grant.access', {
        granteeProjectId: ctx.projectId,
        granterProjectId,
        resource: fileId,
        allowed,
      });
      if (!allowed) {
        throw new Error('forbidden: no active grant covers that file for your project');
      }
      // Resolve the URL against the GRANTER's project (the owner of the bytes).
      const result = await presignDownload(fileId, granterProjectId);
      return jsonResult({
        downloadUrl: result.downloadUrl,
        expiresInSec: result.expiresInSec,
      });
    },
  );

  /* ── auth bridge — read + guidance tools (every scope) ──────────────── */

  registerAuthBridgeTools(server, ctx, auditCall, jsonResult);

  /* ── briven_ask — the general reception desk (every scope) ──────────── */

  registerBrivenAskTool(server, ctx, auditCall, jsonResult);

  /* ── database lifecycle — reads for every scope ──────────────────────── */

  registerDbLifecycleReadTools(server, ctx, auditCall, jsonResult);

  /* ── write tools — ONLY registered for read-write / admin keys ──────── */

  if (ctx.scope === 'read-write' || ctx.scope === 'admin') {
    /* ── storage: issue an S3 key (spec-named alias of storage_mint_key) ─ */
    server.registerTool(
      'storage_issue_key',
      {
        title: 'Issue an S3 storage key',
        description:
          'Issue a bucket-scoped S3 access key for your project storage, usable in ' +
          'any S3 tool. The secret is shown only once — save it now. (Write scope.)',
        inputSchema: { name: z.string().describe('A label for this key') },
        annotations: { readOnlyHint: false },
      },
      async ({ name }) => {
        await auditCall('storage_issue_key', { name });
        const result = await createStorageKey({
          projectId: ctx.projectId,
          name,
          createdBy: null,
          publicEndpoint: env.BRIVEN_MINIO_PUBLIC_ENDPOINT ?? '',
        });
        return jsonResult({
          accessKey: result.accessKey,
          secretKey: result.secretKey,
          endpoint: result.endpoint,
          bucket: result.bucket,
          note: 'the secret is shown only once',
        });
      },
    );

    /* ── storage: revoke one of the project's S3 keys ─────────────────── */
    server.registerTool(
      'storage_revoke_key',
      {
        title: 'Revoke a storage key',
        description:
          'Revoke (disable + remove) one of your project S3 keys by its key id. ' +
          '(Write scope.)',
        inputSchema: { keyId: z.string().describe('The storage key id to revoke') },
        annotations: { readOnlyHint: false },
      },
      async ({ keyId }) => {
        await auditCall('storage_revoke_key', { keyId });
        await revokeStorageKey(ctx.projectId, keyId);
        return jsonResult({ revoked: true, keyId });
      },
    );

    /* ── cross-project sharing (M5): create a grant (caller = GRANTER) ── */
    server.registerTool(
      'storage_grant',
      {
        title: 'Grant a file / prefix to another project',
        description:
          'Share one of YOUR files (or a whole path prefix) with another project. ' +
          'That project can then download exactly the granted resource — nothing ' +
          'else. `resource` is a file id (isPrefix=false) or a path prefix ' +
          '(isPrefix=true). (Write scope.)',
        inputSchema: {
          granteeProjectId: z.string().describe('The project you are sharing with'),
          resource: z.string().describe('A file id, or a path prefix when isPrefix is true'),
          isPrefix: z
            .boolean()
            .optional()
            .describe('true = resource is a path prefix; false (default) = exact file id'),
        },
        annotations: { readOnlyHint: false },
      },
      async ({ granteeProjectId, resource, isPrefix }) => {
        const grant = await createGrant({
          granterProjectId: ctx.projectId,
          granteeProjectId,
          resource,
          isPrefix: isPrefix ?? false,
          createdBy: ctx.keyId,
        });
        await auditCall('storage.grant.create', {
          granterProjectId: ctx.projectId,
          granteeProjectId,
          resource,
          isPrefix: isPrefix ?? false,
          grantId: grant.id,
        });
        return jsonResult({ grant });
      },
    );

    /* ── cross-project sharing (M5): revoke a grant (only the GRANTER) ── */
    server.registerTool(
      'storage_revoke_grant',
      {
        title: 'Revoke a storage grant',
        description:
          'Revoke a cross-project sharing grant YOUR project created, by its grant ' +
          'id. Only the granter can revoke. (Write scope.)',
        inputSchema: { grantId: z.string().describe('The grant id to revoke') },
        annotations: { readOnlyHint: false },
      },
      async ({ grantId }) => {
        const grant = await revokeGrant(ctx.projectId, grantId);
        await auditCall('storage.grant.revoke', {
          granterProjectId: ctx.projectId,
          granteeProjectId: grant.granteeProjectId,
          resource: grant.resource,
          grantId: grant.id,
        });
        return jsonResult({ grant });
      },
    );

    /* ── public share-links (M5): mint a tokenized public link ──────────
     * Exposes ONE of YOUR files to anyone with the link URL, for a limited time
     * (clamped: min 60s, default 24h, max 30 days). The link works even if the
     * file isn't marked public. Audit records the file id + expiry — NEVER the
     * token. (Write scope.) */
    server.registerTool(
      'storage_create_link',
      {
        title: 'Create a public share-link',
        description:
          'Mint a tokenized public download link for one of YOUR files. Anyone with ' +
          'the returned `url` can download that one file — no login — until it ' +
          'expires or you revoke it. `expiresInSeconds` is clamped to [60s, 30 ' +
          'days] and defaults to 24h. Works even if the file is not marked public. ' +
          '(Write scope.)',
        inputSchema: {
          fileId: z.string().describe('The id of your file to share'),
          expiresInSeconds: z
            .number()
            .int()
            .optional()
            .describe('Link lifetime in seconds (clamped 60..2592000; default 86400)'),
        },
        annotations: { readOnlyHint: false },
      },
      async ({ fileId, expiresInSeconds }) => {
        const link = await createShareLink({
          projectId: ctx.projectId,
          fileId,
          expiresInSeconds: expiresInSeconds ?? null,
          createdBy: ctx.keyId,
        });
        // Audit the create — file id + expiry only. NEVER log the token.
        await auditCall('storage.link.create', {
          fileId,
          linkId: link.id,
          expiresAt: link.expiresAt,
        });
        return jsonResult({
          id: link.id,
          url: link.url,
          token: link.token,
          expiresAt: link.expiresAt,
        });
      },
    );

    /* ── public share-links (M5): revoke a link (only the owner) ─────── */
    server.registerTool(
      'storage_revoke_link',
      {
        title: 'Revoke a public share-link',
        description:
          'Revoke a public share-link YOUR project minted, by its link id. The link ' +
          'stops working immediately. Only the owner can revoke. (Write scope.)',
        inputSchema: { linkId: z.string().describe('The share-link id to revoke') },
        annotations: { readOnlyHint: false },
      },
      async ({ linkId }) => {
        const link = await revokeShareLink(ctx.projectId, linkId);
        // Audit the revoke — file id + expiry only. NEVER log the token.
        await auditCall('storage.link.revoke', {
          fileId: link.fileId,
          linkId: link.id,
          expiresAt: link.expiresAt,
        });
        return jsonResult({ id: link.id, revoked: true });
      },
    );


    server.registerTool(
      'create_table',
      {
        title: 'Create a table',
        description:
          'Create a new table in your project. Exactly one column must be marked ' +
          'primaryKey. Types: text, integer, bigint, boolean, timestamptz, jsonb, ' +
          'uuid, numeric. Reuses the same validated path as the Studio "+ new table" button.',
        inputSchema: {
          table: z.string().describe('New table name (snake_case)'),
          columns: z
            .array(
              z.object({
                name: z.string().describe('Column name'),
                type: z.enum(STUDIO_COLUMN_TYPES).describe('Column type'),
                primaryKey: z.boolean().optional().describe('Exactly one column must be true'),
                notNull: z.boolean().optional(),
                defaultExpr: z
                  .string()
                  .nullable()
                  .optional()
                  .describe("SQL default, e.g. 'now()' or 'gen_random_uuid()'"),
                references: z
                  .object({
                    table: z.string(),
                    column: z.string(),
                    onDelete: z
                      .enum(['cascade', 'restrict', 'setNull', 'noAction'])
                      .optional(),
                  })
                  .nullable()
                  .optional()
                  .describe('Optional foreign-key target (same project)'),
              }),
            )
            .min(1)
            .describe('Column definitions'),
        },
        annotations: { readOnlyHint: false },
      },
      async ({ table, columns }) => {
        await auditCall('create_table', { table });
        const result = await createTable({ projectId: ctx.projectId, tableName: table, columns });
        return jsonResult(result);
      },
    );

    server.registerTool(
      'insert',
      {
        title: 'Insert a row',
        description: 'Insert one row into a table. Returns the stored row (defaults filled in).',
        inputSchema: {
          table: z.string().describe('Target table in your project'),
          values: z.record(z.string(), z.unknown()).describe('Column → value map'),
        },
        annotations: { readOnlyHint: false },
      },
      async ({ table, values }) => {
        await auditCall('insert', { table });
        const result = await insertRow({ projectId: ctx.projectId, tableName: table, values });
        return jsonResult(result);
      },
    );

    server.registerTool(
      'update',
      {
        title: 'Update rows',
        description:
          'Update rows that match every column in `match`, setting the columns in `set`. ' +
          'Both maps are required (an unbounded update is refused). Returns affected row count.',
        inputSchema: {
          table: z.string().describe('Target table in your project'),
          match: z.record(z.string(), z.unknown()).describe('Column → value AND-matched WHERE'),
          set: z.record(z.string(), z.unknown()).describe('Column → new value'),
        },
        annotations: { readOnlyHint: false },
      },
      async ({ table, match, set }) => {
        await auditCall('update', { table });
        const affected = await runUpdate(ctx.projectId, table, match, set);
        return jsonResult({ affected });
      },
    );

    server.registerTool(
      'delete',
      {
        title: 'Delete rows',
        description:
          'Delete rows that match every column in `match`. `match` is required (an ' +
          'unbounded delete is refused). Returns affected row count.',
        inputSchema: {
          table: z.string().describe('Target table in your project'),
          match: z.record(z.string(), z.unknown()).describe('Column → value AND-matched WHERE'),
        },
        annotations: { readOnlyHint: false },
      },
      async ({ table, match }) => {
        await auditCall('delete', { table });
        const affected = await runDelete(ctx.projectId, table, match);
        return jsonResult({ affected });
      },
    );

    /* ── database lifecycle — restart + recover (write scope) ──────────── */

    registerDbLifecycleWriteTools(server, ctx, auditCall, jsonResult);
  }

  /* ── admin-only — the destructive lifecycle tail ─────────────────────── */

  if (ctx.scope === 'admin') {
    registerDbLifecycleAdminTools(server, ctx, auditCall, jsonResult);
  }

  return server;
}

/**
 * The tool names a key of each scope is allowed to see. Exported for tests.
 *
 * READ_TOOLS are registered for EVERY scope (read, read-write, admin);
 * WRITE_TOOLS are registered ONLY for read-write / admin. Keep this list in
 * lock-step with the `server.registerTool(...)` calls above — the mcp-server
 * test asserts `tools/list` equals exactly these per scope.
 */
export const READ_TOOLS = [
  // data-plane reads
  'list_tables',
  'describe_table',
  'query',
  // storage reads (available to every scope)
  'storage_list_files',
  'storage_usage',
  'storage_upload_url',
  'storage_download_url',
  'storage_delete_file',
  'storage_make_public',
  'storage_mint_key',
  'storage_list_keys',
  'storage_transform_url',
  // cross-project sharing reads (M5)
  'storage_list_grants',
  'storage_shared_download_url',
  // public share-link reads (M5)
  'storage_list_links',
  // auth bridge — read + guidance (mcp-auth-bridge.ts)
  ...AUTH_BRIDGE_TOOLS,
  // general reception desk (mcp-briven-ask.ts)
  ...BRIVEN_ASK_TOOLS,
  // database lifecycle reads (mcp-db-lifecycle.ts)
  ...DB_LIFECYCLE_READ_TOOLS,
] as const;
export const WRITE_TOOLS = [
  // data-plane writes
  'create_table',
  'insert',
  'update',
  'delete',
  // storage writes (M5 — read-write / admin only)
  'storage_issue_key',
  'storage_revoke_key',
  'storage_grant',
  'storage_revoke_grant',
  // public share-link writes (M5 — read-write / admin only)
  'storage_create_link',
  'storage_revoke_link',
  // database lifecycle writes (mcp-db-lifecycle.ts)
  ...DB_LIFECYCLE_WRITE_TOOLS,
] as const;
/** Registered ONLY for admin-scope keys — the destructive lifecycle tail. */
export const ADMIN_TOOLS = [...DB_LIFECYCLE_ADMIN_TOOLS] as const;

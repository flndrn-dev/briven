/**
 * SCIM 2.0 provisioning for Briven Auth (Phase 9 / enterprise directory sync).
 *
 * Company IdPs (Okta, Entra, Google Workspace) push user/group lifecycle here.
 * Tokens live in the project data-plane (`_briven_auth_scim_tokens`); user
 * mapping in `_briven_auth_scim_users`. Protocol routes use Bearer only —
 * no dashboard session.
 *
 * Spec subset: Users + Groups CRUD, ServiceProviderConfig, basic `eq` filter.
 */

import { createHash, randomBytes } from 'node:crypto';

import { NotFoundError, ValidationError, newId } from '@briven/shared';

import { runInProjectDatabase } from '../db/data-plane.js';
import { AUTH_SCIM_DDL_SQL } from './auth-provisioning.js';
import { banUser, unbanUser } from './auth-security.js';
import { log } from '../lib/logger.js';

const TOKEN_PREFIX = 'scim_briven_';
const TOKEN_ENTROPY = 32;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

export class ScimError extends Error {
  constructor(
    public readonly status: number,
    public readonly scimType: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ScimError';
  }

  toJson() {
    return {
      schemas: [SCIM_ERROR_SCHEMA],
      status: String(this.status),
      scimType: this.scimType,
      detail: this.message,
    };
  }
}

/** Ensure SCIM tables exist (idempotent). Call before token or protocol ops. */
export async function ensureScimTables(projectId: string): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    for (const stmt of AUTH_SCIM_DDL_SQL) {
      await tx.unsafe(stmt);
    }
  });
}

// ─── Tokens (dashboard admin) ──────────────────────────────────────────────

export interface CreatedScimToken {
  id: string;
  name: string;
  prefix: string;
  suffix: string;
  createdAt: string;
  /** Plaintext — returned once. */
  plaintext: string;
}

export interface MaskedScimToken {
  id: string;
  name: string;
  prefix: string;
  suffix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export async function createScimToken(
  projectId: string,
  name: string,
): Promise<CreatedScimToken> {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 64) {
    throw new ValidationError('name must be 1-64 chars', { name });
  }
  await ensureScimTables(projectId);
  const plaintext = `${TOKEN_PREFIX}${randomBytes(TOKEN_ENTROPY).toString('base64url')}`;
  const hash = hashToken(plaintext);
  const id = newId('scimtok');
  const suffix = plaintext.slice(-4);
  const createdAt = new Date().toISOString();

  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `INSERT INTO "_briven_auth_scim_tokens"
         (id, name, hash, prefix, suffix, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
      [id, trimmed, hash, TOKEN_PREFIX, suffix, createdAt] as never[],
    );
  });

  return { id, name: trimmed, prefix: TOKEN_PREFIX, suffix, createdAt, plaintext };
}

export async function listScimTokens(projectId: string): Promise<MaskedScimToken[]> {
  await ensureScimTables(projectId);
  const rows = await runInProjectDatabase<
    Array<{
      id: string;
      name: string;
      prefix: string;
      suffix: string;
      created_at: Date;
      last_used_at: Date | null;
      revoked_at: Date | null;
    }>
  >(projectId, async (tx) =>
    tx.unsafe(
      `SELECT id, name, prefix, suffix, created_at, last_used_at, revoked_at
       FROM "_briven_auth_scim_tokens"
       ORDER BY created_at DESC
       LIMIT 100`,
    ),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    suffix: r.suffix,
    createdAt: toIso(r.created_at),
    lastUsedAt: r.last_used_at ? toIso(r.last_used_at) : null,
    revokedAt: r.revoked_at ? toIso(r.revoked_at) : null,
  }));
}

export async function revokeScimToken(projectId: string, tokenId: string): Promise<void> {
  await ensureScimTables(projectId);
  const updated = await runInProjectDatabase<Array<{ id: string }>>(projectId, async (tx) =>
    tx.unsafe(
      `UPDATE "_briven_auth_scim_tokens"
       SET revoked_at = now()
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING id`,
      [tokenId] as never[],
    ),
  );
  if (updated.length === 0) {
    throw new NotFoundError('scim token not found or already revoked');
  }
}

/**
 * Verify Bearer token for a project. Returns true if valid.
 * Touches last_used_at on success.
 */
export async function verifyScimBearer(projectId: string, bearer: string | null): Promise<boolean> {
  if (!bearer || !bearer.startsWith(TOKEN_PREFIX)) return false;
  await ensureScimTables(projectId);
  const hash = hashToken(bearer);
  const rows = await runInProjectDatabase<Array<{ id: string }>>(projectId, async (tx) =>
    tx.unsafe(
      `UPDATE "_briven_auth_scim_tokens"
       SET last_used_at = now()
       WHERE hash = $1 AND revoked_at IS NULL
       RETURNING id`,
      [hash] as never[],
    ),
  );
  return rows.length > 0;
}

// ─── SCIM Users ────────────────────────────────────────────────────────────

export interface ScimUserResource {
  schemas: string[];
  id: string;
  externalId?: string;
  userName: string;
  active: boolean;
  displayName?: string;
  name?: { formatted?: string; givenName?: string; familyName?: string };
  emails?: Array<{ value: string; primary?: boolean; type?: string }>;
  meta: { resourceType: 'User'; created: string; lastModified: string; location: string };
}

export function scimUserLocation(projectId: string, scimId: string, apiOrigin: string): string {
  return `${apiOrigin.replace(/\/$/, '')}/v1/projects/${projectId}/scim/v2/Users/${scimId}`;
}

export function scimGroupLocation(projectId: string, scimId: string, apiOrigin: string): string {
  return `${apiOrigin.replace(/\/$/, '')}/v1/projects/${projectId}/scim/v2/Groups/${scimId}`;
}

/** Pure: extract primary email + display name from a SCIM User payload. */
export function parseScimUserPayload(body: unknown): {
  userName: string;
  email: string;
  displayName: string | null;
  externalId: string | null;
  active: boolean;
  raw: Record<string, unknown>;
} {
  if (!body || typeof body !== 'object') {
    throw new ScimError(400, 'invalidValue', 'body must be a JSON object');
  }
  const o = body as Record<string, unknown>;
  const userName =
    typeof o.userName === 'string' && o.userName.trim()
      ? o.userName.trim()
      : typeof o.user_name === 'string'
        ? o.user_name.trim()
        : '';
  if (!userName) {
    throw new ScimError(400, 'invalidValue', 'userName is required');
  }

  let email = userName.includes('@') ? userName : '';
  if (Array.isArray(o.emails)) {
    const emails = o.emails as Array<Record<string, unknown>>;
    const primary = emails.find((e) => e.primary === true) ?? emails[0];
    if (primary && typeof primary.value === 'string') {
      email = primary.value.trim();
    }
  }
  if (!email || !EMAIL_RE.test(email)) {
    throw new ScimError(400, 'invalidValue', 'a valid email is required (userName or emails[0])');
  }

  let displayName: string | null = null;
  if (typeof o.displayName === 'string' && o.displayName.trim()) {
    displayName = o.displayName.trim();
  } else if (o.name && typeof o.name === 'object') {
    const n = o.name as Record<string, unknown>;
    if (typeof n.formatted === 'string') displayName = n.formatted;
    else {
      const parts = [n.givenName, n.familyName].filter(
        (x): x is string => typeof x === 'string' && x.length > 0,
      );
      if (parts.length) displayName = parts.join(' ');
    }
  }

  const externalId = typeof o.externalId === 'string' ? o.externalId : null;
  const active = o.active === false ? false : true;

  return {
    userName,
    email: email.toLowerCase(),
    displayName,
    externalId,
    active,
    raw: o,
  };
}

/** Pure: very small SCIM filter parser — supports `attr eq "value"`. */
export function parseScimEqFilter(
  filter: string | undefined,
): { attr: string; value: string } | null {
  if (!filter || !filter.trim()) return null;
  const m = filter.trim().match(/^(\w+(?:\.\w+)?)\s+eq\s+"([^"]*)"$/i);
  if (!m) {
    throw new ScimError(400, 'invalidFilter', `unsupported filter: ${filter}`);
  }
  return { attr: m[1]!.toLowerCase(), value: m[2]! };
}

export async function scimCreateUser(
  projectId: string,
  body: unknown,
  apiOrigin: string,
): Promise<ScimUserResource> {
  await ensureScimTables(projectId);
  const parsed = parseScimUserPayload(body);

  const scimId = newId('scimu');
  const userId = newId('u');
  const now = new Date().toISOString();

  try {
    await runInProjectDatabase(projectId, async (tx) => {
      const existing = (await tx.unsafe(
        `SELECT id FROM "_briven_auth_users" WHERE lower(email) = lower($1) LIMIT 1`,
        [parsed.email] as never[],
      )) as Array<{ id: string }>;
      if (existing.length > 0) {
        throw new ScimError(409, 'uniqueness', `user with email ${parsed.email} already exists`);
      }
      const existingScim = (await tx.unsafe(
        `SELECT id FROM "_briven_auth_scim_users" WHERE lower(user_name) = lower($1) LIMIT 1`,
        [parsed.userName] as never[],
      )) as Array<{ id: string }>;
      if (existingScim.length > 0) {
        throw new ScimError(409, 'uniqueness', `userName ${parsed.userName} already exists`);
      }

      await tx.unsafe(
        `INSERT INTO "_briven_auth_users" (id, email, name, email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, true, $4::timestamptz, $4::timestamptz)`,
        [userId, parsed.email, parsed.displayName, now] as never[],
      );

      // SCIM-provisioned account — no password; sign-in via SSO / magic / invite later.
      await tx.unsafe(
        `INSERT INTO "_briven_auth_accounts"
           (id, user_id, account_id, provider_id, scope, created_at, updated_at)
         VALUES ($1, $2, $3, 'scim', 'provisioned', $4::timestamptz, $4::timestamptz)`,
        [newId('a'), userId, userId, now] as never[],
      );

      await tx.unsafe(
        `INSERT INTO "_briven_auth_scim_users"
           (id, user_id, external_id, user_name, active, display_name, raw, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz, $8::timestamptz)`,
        [
          scimId,
          userId,
          parsed.externalId,
          parsed.userName,
          parsed.active,
          parsed.displayName,
          JSON.stringify(parsed.raw),
          now,
        ] as never[],
      );
    });
  } catch (err) {
    if (err instanceof ScimError) throw err;
    log.warn('scim_create_user_failed', {
      projectId,
      message: err instanceof Error ? err.message : String(err),
    });
    throw new ScimError(500, undefined, 'failed to create user');
  }

  if (!parsed.active) {
    await banUser(projectId, userId, { reason: 'scim_inactive' });
  }

  return toScimUser(
    {
      id: scimId,
      user_id: userId,
      external_id: parsed.externalId,
      user_name: parsed.userName,
      active: parsed.active,
      display_name: parsed.displayName,
      email: parsed.email,
      created_at: now,
      updated_at: now,
    },
    projectId,
    apiOrigin,
  );
}

export async function scimGetUser(
  projectId: string,
  scimId: string,
  apiOrigin: string,
): Promise<ScimUserResource> {
  await ensureScimTables(projectId);
  const row = await loadScimUserRow(projectId, scimId);
  if (!row) throw new ScimError(404, undefined, 'User not found');
  return toScimUser(row, projectId, apiOrigin);
}

export async function scimListUsers(
  projectId: string,
  opts: { filter?: string; startIndex?: number; count?: number },
  apiOrigin: string,
): Promise<{
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: ScimUserResource[];
}> {
  await ensureScimTables(projectId);
  const startIndex = Math.max(1, opts.startIndex ?? 1);
  const count = Math.min(200, Math.max(1, opts.count ?? 100));
  const offset = startIndex - 1;
  const eq = parseScimEqFilter(opts.filter);

  const { rows, total } = await runInProjectDatabase(projectId, async (tx) => {
    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (eq) {
      if (eq.attr === 'username') {
        params.push(eq.value);
        where += ` AND lower(s.user_name) = lower($${params.length})`;
      } else if (eq.attr === 'externalid') {
        params.push(eq.value);
        where += ` AND s.external_id = $${params.length}`;
      } else if (eq.attr === 'emails' || eq.attr === 'emails.value') {
        params.push(eq.value);
        where += ` AND lower(u.email) = lower($${params.length})`;
      } else {
        throw new ScimError(400, 'invalidFilter', `unsupported filter attribute: ${eq.attr}`);
      }
    }

    const countRows = (await tx.unsafe(
      `SELECT COUNT(*)::int AS c
       FROM "_briven_auth_scim_users" s
       JOIN "_briven_auth_users" u ON u.id = s.user_id
       ${where}`,
      params as never[],
    )) as Array<{ c: number | string }>;
    const totalRaw = countRows[0]?.c ?? 0;
    const totalN = typeof totalRaw === 'string' ? Number.parseInt(totalRaw, 10) : totalRaw;

    params.push(count, offset);
    const list = (await tx.unsafe(
      `SELECT s.id, s.user_id, s.external_id, s.user_name, s.active, s.display_name,
              s.created_at, s.updated_at, u.email
       FROM "_briven_auth_scim_users" s
       JOIN "_briven_auth_users" u ON u.id = s.user_id
       ${where}
       ORDER BY s.created_at ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params as never[],
    )) as ScimUserRow[];

    return { rows: list, total: totalN };
  });

  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: total,
    startIndex,
    itemsPerPage: rows.length,
    Resources: rows.map((r) => toScimUser(r, projectId, apiOrigin)),
  };
}

export async function scimReplaceUser(
  projectId: string,
  scimId: string,
  body: unknown,
  apiOrigin: string,
): Promise<ScimUserResource> {
  await ensureScimTables(projectId);
  const existing = await loadScimUserRow(projectId, scimId);
  if (!existing) throw new ScimError(404, undefined, 'User not found');
  const parsed = parseScimUserPayload(body);
  const now = new Date().toISOString();

  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `UPDATE "_briven_auth_users"
       SET email = $2, name = $3, updated_at = $4::timestamptz
       WHERE id = $1`,
      [existing.user_id, parsed.email, parsed.displayName, now] as never[],
    );
    await tx.unsafe(
      `UPDATE "_briven_auth_scim_users"
       SET external_id = $2, user_name = $3, active = $4, display_name = $5,
           raw = $6::jsonb, updated_at = $7::timestamptz
       WHERE id = $1`,
      [
        scimId,
        parsed.externalId,
        parsed.userName,
        parsed.active,
        parsed.displayName,
        JSON.stringify(parsed.raw),
        now,
      ] as never[],
    );
  });

  if (parsed.active) {
    await unbanUser(projectId, existing.user_id);
  } else {
    await banUser(projectId, existing.user_id, { reason: 'scim_inactive' });
  }

  return scimGetUser(projectId, scimId, apiOrigin);
}

export async function scimPatchUser(
  projectId: string,
  scimId: string,
  body: unknown,
  apiOrigin: string,
): Promise<ScimUserResource> {
  await ensureScimTables(projectId);
  const existing = await loadScimUserRow(projectId, scimId);
  if (!existing) throw new ScimError(404, undefined, 'User not found');

  // Support common Okta/Entra: { Operations: [{ op: "Replace", path: "active", value: false }] }
  // and full replace-ish body with userName/emails.
  if (body && typeof body === 'object' && Array.isArray((body as { Operations?: unknown }).Operations)) {
    const ops = (body as { Operations: Array<Record<string, unknown>> }).Operations;
    let active = existing.active;
    let displayName = existing.display_name;
    let email = existing.email;
    let userName = existing.user_name;

    for (const op of ops) {
      const opName = String(op.op ?? '').toLowerCase();
      if (opName !== 'replace' && opName !== 'add') continue;
      const path = typeof op.path === 'string' ? op.path.toLowerCase() : '';
      if (path === 'active' || (!path && typeof op.value === 'object' && op.value && 'active' in (op.value as object))) {
        const v =
          path === 'active'
            ? op.value
            : (op.value as { active?: unknown }).active;
        active = v !== false && v !== 'False' && v !== 'false';
      }
      if (path === 'displayname' && typeof op.value === 'string') {
        displayName = op.value;
      }
      if (path === 'username' && typeof op.value === 'string') {
        userName = op.value;
      }
      if ((path === 'emails' || path.startsWith('emails')) && Array.isArray(op.value)) {
        const first = (op.value as Array<{ value?: string }>)[0];
        if (first?.value) email = first.value;
      }
      if (!path && op.value && typeof op.value === 'object') {
        const v = op.value as Record<string, unknown>;
        if (typeof v.userName === 'string') userName = v.userName;
        if (typeof v.displayName === 'string') displayName = v.displayName;
        if (typeof v.active === 'boolean') active = v.active;
      }
    }

    return scimReplaceUser(
      projectId,
      scimId,
      {
        userName,
        displayName,
        active,
        emails: [{ value: email, primary: true }],
        externalId: existing.external_id,
      },
      apiOrigin,
    );
  }

  return scimReplaceUser(projectId, scimId, body, apiOrigin);
}

export async function scimDeleteUser(projectId: string, scimId: string): Promise<void> {
  await ensureScimTables(projectId);
  const existing = await loadScimUserRow(projectId, scimId);
  if (!existing) throw new ScimError(404, undefined, 'User not found');

  // Hard delete user (cascade sessions/accounts); SCIM row cascades via FK.
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(`DELETE FROM "_briven_auth_users" WHERE id = $1`, [existing.user_id] as never[]);
  });
}

// ─── SCIM Groups ───────────────────────────────────────────────────────────

export interface ScimGroupResource {
  schemas: string[];
  id: string;
  externalId?: string;
  displayName: string;
  members?: Array<{ value: string; display?: string; type?: string }>;
  meta: { resourceType: 'Group'; created: string; lastModified: string; location: string };
}

export async function scimCreateGroup(
  projectId: string,
  body: unknown,
  apiOrigin: string,
): Promise<ScimGroupResource> {
  await ensureScimTables(projectId);
  if (!body || typeof body !== 'object') {
    throw new ScimError(400, 'invalidValue', 'body must be a JSON object');
  }
  const o = body as Record<string, unknown>;
  const displayName = typeof o.displayName === 'string' ? o.displayName.trim() : '';
  if (!displayName) throw new ScimError(400, 'invalidValue', 'displayName is required');
  const externalId = typeof o.externalId === 'string' ? o.externalId : null;
  const members = Array.isArray(o.members)
    ? (o.members as Array<{ value?: string }>)
        .map((m) => m.value)
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];

  const id = newId('scimg');
  const now = new Date().toISOString();

  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `INSERT INTO "_briven_auth_scim_groups"
         (id, display_name, external_id, active, raw, created_at, updated_at)
       VALUES ($1, $2, $3, true, $4::jsonb, $5::timestamptz, $5::timestamptz)`,
      [id, displayName, externalId, JSON.stringify(o), now] as never[],
    );
    for (const memberId of members) {
      await tx.unsafe(
        `INSERT INTO "_briven_auth_scim_group_members" (group_id, member_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id, memberId] as never[],
      );
    }
  });

  // Phase 9.2: map group → org role when configured.
  if (members.length > 0) {
    try {
      const { applyScimGroupRoleMaps } = await import('./auth-scim-role-maps.js');
      await applyScimGroupRoleMaps(projectId, displayName, members);
    } catch (err) {
      log.warn('scim_group_role_map_failed', {
        projectId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return scimGetGroup(projectId, id, apiOrigin);
}

export async function scimGetGroup(
  projectId: string,
  groupId: string,
  apiOrigin: string,
): Promise<ScimGroupResource> {
  await ensureScimTables(projectId);
  const g = await runInProjectDatabase<
    Array<{
      id: string;
      display_name: string;
      external_id: string | null;
      created_at: Date | string;
      updated_at: Date | string;
    }>
  >(projectId, async (tx) =>
    tx.unsafe(
      `SELECT id, display_name, external_id, created_at, updated_at
       FROM "_briven_auth_scim_groups" WHERE id = $1 LIMIT 1`,
      [groupId] as never[],
    ),
  );
  if (!g[0]) throw new ScimError(404, undefined, 'Group not found');

  const members = await runInProjectDatabase<Array<{ member_id: string }>>(projectId, async (tx) =>
    tx.unsafe(
      `SELECT member_id FROM "_briven_auth_scim_group_members" WHERE group_id = $1`,
      [groupId] as never[],
    ),
  );

  const row = g[0];
  return {
    schemas: [SCIM_GROUP_SCHEMA],
    id: row.id,
    externalId: row.external_id ?? undefined,
    displayName: row.display_name,
    members: members.map((m) => ({ value: m.member_id, type: 'User' })),
    meta: {
      resourceType: 'Group',
      created: toIso(row.created_at),
      lastModified: toIso(row.updated_at),
      location: scimGroupLocation(projectId, row.id, apiOrigin),
    },
  };
}

export async function scimListGroups(
  projectId: string,
  opts: { startIndex?: number; count?: number },
  apiOrigin: string,
): Promise<{
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: ScimGroupResource[];
}> {
  await ensureScimTables(projectId);
  const startIndex = Math.max(1, opts.startIndex ?? 1);
  const count = Math.min(200, Math.max(1, opts.count ?? 100));
  const offset = startIndex - 1;

  const { rows, total } = await runInProjectDatabase(projectId, async (tx) => {
    const countRows = (await tx.unsafe(
      `SELECT COUNT(*)::int AS c FROM "_briven_auth_scim_groups"`,
    )) as Array<{ c: number | string }>;
    const totalRaw = countRows[0]?.c ?? 0;
    const totalN = typeof totalRaw === 'string' ? Number.parseInt(totalRaw, 10) : totalRaw;
    const list = (await tx.unsafe(
      `SELECT id, display_name, external_id, created_at, updated_at
       FROM "_briven_auth_scim_groups"
       ORDER BY created_at ASC
       LIMIT $1 OFFSET $2`,
      [count, offset] as never[],
    )) as Array<{
      id: string;
      display_name: string;
      external_id: string | null;
      created_at: Date | string;
      updated_at: Date | string;
    }>;
    return { rows: list, total: totalN };
  });

  const Resources: ScimGroupResource[] = [];
  for (const row of rows) {
    Resources.push(await scimGetGroup(projectId, row.id, apiOrigin));
  }

  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: total,
    startIndex,
    itemsPerPage: Resources.length,
    Resources,
  };
}

export async function scimDeleteGroup(projectId: string, groupId: string): Promise<void> {
  await ensureScimTables(projectId);
  const deleted = await runInProjectDatabase<Array<{ id: string }>>(projectId, async (tx) =>
    tx.unsafe(
      `DELETE FROM "_briven_auth_scim_groups" WHERE id = $1 RETURNING id`,
      [groupId] as never[],
    ),
  );
  if (deleted.length === 0) throw new ScimError(404, undefined, 'Group not found');
}

export function scimServiceProviderConfig() {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description: 'Briven SCIM token (scim_briven_…)',
        specUri: 'https://www.rfc-editor.org/rfc/rfc6750',
        primary: true,
      },
    ],
  };
}

export function scimResourceTypes(projectId: string, apiOrigin: string) {
  const base = `${apiOrigin.replace(/\/$/, '')}/v1/projects/${projectId}/scim/v2`;
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: 2,
    Resources: [
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'User',
        name: 'User',
        endpoint: `${base}/Users`,
        schema: SCIM_USER_SCHEMA,
      },
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'Group',
        name: 'Group',
        endpoint: `${base}/Groups`,
        schema: SCIM_GROUP_SCHEMA,
      },
    ],
  };
}

// ─── internals ─────────────────────────────────────────────────────────────

function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

function toIso(v: Date | string): string {
  if (v instanceof Date) return v.toISOString();
  return new Date(v).toISOString();
}

interface ScimUserRow {
  id: string;
  user_id: string;
  external_id: string | null;
  user_name: string;
  active: boolean;
  display_name: string | null;
  email: string;
  created_at: Date | string;
  updated_at: Date | string;
}

async function loadScimUserRow(projectId: string, scimId: string): Promise<ScimUserRow | null> {
  const rows = await runInProjectDatabase<ScimUserRow[]>(projectId, async (tx) =>
    tx.unsafe(
      `SELECT s.id, s.user_id, s.external_id, s.user_name, s.active, s.display_name,
              s.created_at, s.updated_at, u.email
       FROM "_briven_auth_scim_users" s
       JOIN "_briven_auth_users" u ON u.id = s.user_id
       WHERE s.id = $1
       LIMIT 1`,
      [scimId] as never[],
    ),
  );
  return rows[0] ?? null;
}

function toScimUser(row: ScimUserRow, projectId: string, apiOrigin: string): ScimUserResource {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: row.id,
    externalId: row.external_id ?? undefined,
    userName: row.user_name,
    active: row.active,
    displayName: row.display_name ?? undefined,
    name: row.display_name ? { formatted: row.display_name } : undefined,
    emails: [{ value: row.email, primary: true, type: 'work' }],
    meta: {
      resourceType: 'User',
      created: toIso(row.created_at),
      lastModified: toIso(row.updated_at),
      location: scimUserLocation(projectId, row.id, apiOrigin),
    },
  };
}

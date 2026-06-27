import { ValidationError } from '@briven/shared';

import { runInProjectDatabase } from '../db/data-plane.js';

/**
 * Briven auth users — list + detail with hard redaction per CLAUDE.md §5.1
 * and BUILD_PLAN.md §4 (admin user-list response). Full email + raw IP
 * NEVER leave the api; the dashboard sees only:
 *   - domain hint (chars after `@`)
 *   - first character of `name`
 *   - linked provider ids
 *   - last-seen timestamp (max(sessions.created_at))
 *   - created_at
 *
 * Search-by-email is supported as a hashed lookup (caller hashes the
 * email client-side or server-side; the api compares against a stored
 * hash — that path lands when we add the search index. v0 just lists).
 */

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export interface ListUsersOpts {
  readonly limit?: number;
  readonly cursor?: string | null;
}

export interface RedactedUser {
  /** ULID. Stable identifier safe to surface in dashboard. */
  id: string;
  /** Domain portion of email — `gmail.com` from `alice@gmail.com`. */
  emailDomainHint: string;
  /** First character of `name`, or null when name is unset. */
  nameInitial: string | null;
  /** Linked OAuth + native provider ids (`['google','passkey','email']`). */
  providerIds: string[];
  /** ISO-8601 timestamp of the most recent session. Null when never signed in. */
  lastSeenAt: string | null;
  /** ISO-8601 timestamp the user row was created. */
  createdAt: string;
}

export interface UserListResult {
  items: RedactedUser[];
  nextCursor: string | null;
}

/**
 * Per-user detail view — used by `/auth/users/[userId]/page.tsx`. Same
 * redaction rules as the list view: no raw email, no raw IP, name reduced
 * to its first character. `domainHint` is kept so the admin has *some*
 * identifying signal beyond the opaque id.
 */
export interface UserDetail {
  id: string;
  emailDomainHint: string;
  nameInitial: string | null;
  createdAt: string;
  sessions: ReadonlyArray<{
    id: string;
    createdAt: string;
    expiresAt: string;
    /** First 8 chars of the stored sha-256 ip hash — enough to identify
     *  the device row without exposing the underlying ip. */
    ipHashHint: string | null;
    /** First 96 chars of the user agent, single-line, no rewriting. */
    userAgent: string | null;
  }>;
  accounts: ReadonlyArray<{
    id: string;
    providerId: string;
    providerAccountId: string;
    createdAt: string;
  }>;
  audit: ReadonlyArray<{
    id: string;
    action: string;
    occurredAt: string;
    metadata: Record<string, unknown>;
  }>;
}

interface RawUserJoinRow {
  id: string;
  email: string;
  name: string | null;
  created_at: Date;
  last_seen_at: Date | null;
  provider_ids: string[] | null;
}

interface RawUserRow {
  id: string;
  email: string;
  name: string | null;
  created_at: Date;
}

interface RawSessionRow {
  id: string;
  created_at: Date;
  expires_at: Date;
  // Better-Auth session column (S2.1b). IP tracking is disabled, so null.
  ip_address: string | null;
  user_agent: string | null;
}

interface RawAccountRow {
  id: string;
  provider_id: string;
  // Better-Auth's natural account key (was provider_account_id) — S2.1b.
  account_id: string;
  created_at: Date;
}

interface RawAuditRow {
  id: string;
  action: string;
  occurred_at: Date;
  metadata: Record<string, unknown> | null;
}

/**
 * Pure redaction step — visible for tests. Same shape as the postgres
 * row returned by `listProjectUsers`'s SELECT, minus the timestamps
 * already serialised to ISO-8601 strings.
 */
export function redactUserRow(row: {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  providerIds: string[];
}): RedactedUser {
  return {
    id: row.id,
    emailDomainHint: domainHintFromEmail(row.email),
    nameInitial: nameInitialFrom(row.name),
    providerIds: row.providerIds,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
  };
}

export function domainHintFromEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 0 || at === email.length - 1) return '?';
  return email.slice(at + 1).toLowerCase();
}

export function nameInitialFrom(name: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  // First character — handles unicode by taking the first grapheme. JS
  // string[0] would split a surrogate pair; Array.from breaks at code-point
  // boundaries which is good enough for a dashboard initial.
  return Array.from(trimmed)[0] ?? null;
}

/**
 * List redacted users for a project. Cursor pagination on `(created_at, id)`
 * to avoid OFFSET scans on growing tables. Cursor format: `<iso>__<id>`
 * (URL-safe; the dashboard treats it as opaque).
 */
export async function listProjectUsers(
  projectId: string,
  opts: ListUsersOpts = {},
): Promise<UserListResult> {
  const limit = clamp(opts.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);

  let cursorClause = '';
  const params: unknown[] = [];

  if (opts.cursor) {
    const parsed = parseCursor(opts.cursor);
    cursorClause =
      'AND (u.created_at < $1::timestamptz OR (u.created_at = $1::timestamptz AND u.id < $2))';
    params.push(parsed.createdAt, parsed.id);
  }

  // Pull `limit + 1` to detect "has more" without a separate count.
  params.push(limit + 1);
  const limitPlaceholder = `$${params.length}`;

  const rows = await runInProjectDatabase<RawUserJoinRow[]>(projectId, async (tx) => {
    // DoltGres leaks a hidden expression-index column
    // ("!hidden!_briven_auth_users_email_uniq!…") into query scope whenever a
    // correlated subquery runs against `_briven_auth_users` — which has a
    // UNIQUE INDEX on `lower(email)`. The old single-query form (correlated
    // MAX + ARRAY subqueries) tripped exactly that and 500'd. So we fetch the
    // user page with a plain SELECT, then enrich last-seen + providers with
    // two simple `IN (…)` companion queries and stitch in JS. No correlated
    // subquery touches the users table. (Verified on DoltGres.)
    const userRows = (await tx.unsafe(
      `
        SELECT u.id, u.email, u.name, u.created_at
        FROM "_briven_auth_users" u
        WHERE 1=1 ${cursorClause}
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT ${limitPlaceholder}
      `,
      params as never[],
    )) as Array<{ id: string; email: string; name: string | null; created_at: Date }>;

    if (userRows.length === 0) return [];

    const ids = userRows.map((r) => r.id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');

    // last-seen per user = newest session (plain GROUP BY, no correlation).
    const sessionRows = (await tx.unsafe(
      `
        SELECT user_id, MAX(created_at) AS last_seen
        FROM "_briven_auth_sessions"
        WHERE user_id IN (${placeholders})
        GROUP BY user_id
      `,
      ids as never[],
    )) as Array<{ user_id: string; last_seen: Date | null }>;
    const lastSeenById = new Map<string, Date | null>();
    for (const s of sessionRows) lastSeenById.set(s.user_id, s.last_seen);

    // providers per user — deduped + sorted in JS (replaces DISTINCT/ORDER BY).
    const accountRows = (await tx.unsafe(
      `
        SELECT user_id, provider_id
        FROM "_briven_auth_accounts"
        WHERE user_id IN (${placeholders})
      `,
      ids as never[],
    )) as Array<{ user_id: string; provider_id: string }>;
    const providersById = new Map<string, Set<string>>();
    for (const a of accountRows) {
      let set = providersById.get(a.user_id);
      if (!set) {
        set = new Set<string>();
        providersById.set(a.user_id, set);
      }
      set.add(a.provider_id);
    }

    return userRows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      created_at: u.created_at,
      last_seen_at: lastSeenById.get(u.id) ?? null,
      provider_ids: providersById.has(u.id)
        ? [...providersById.get(u.id)!].sort()
        : [],
    })) as unknown as RawUserJoinRow[];
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const items = page.map((r) =>
    redactUserRow({
      id: r.id,
      email: r.email,
      name: r.name,
      createdAt: r.created_at.toISOString(),
      lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null,
      providerIds: r.provider_ids ?? [],
    }),
  );

  const nextCursor = hasMore
    ? formatCursor({
        createdAt: page[page.length - 1]!.created_at.toISOString(),
        id: page[page.length - 1]!.id,
      })
    : null;

  return { items, nextCursor };
}

const USER_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const SESSIONS_CAP = 50;
const AUDIT_CAP = 50;
const USER_AGENT_CAP = 96;

/**
 * Detail view of a single user. Returns `null` when the user id is not
 * present in this project's schema — callers translate to 404. Sessions
 * are filtered to currently-active (`expires_at > now()`) and capped at
 * 50; audit is capped at the 50 most recent entries.
 */
export async function getProjectUserDetail(
  projectId: string,
  userId: string,
): Promise<UserDetail | null> {
  if (!USER_ID_RE.test(userId)) {
    throw new ValidationError('invalid user id', { userId });
  }

  return runInProjectDatabase<UserDetail | null>(projectId, async (tx) => {
    const userRows = (await tx.unsafe(
      `SELECT id, email, name, created_at
       FROM "_briven_auth_users"
       WHERE id = $1
       LIMIT 1`,
      [userId] as never[],
    )) as RawUserRow[];

    const user = userRows[0];
    if (!user) return null;

    const sessionRows = (await tx.unsafe(
      `SELECT id, created_at, expires_at, ip_address, user_agent
       FROM "_briven_auth_sessions"
       WHERE user_id = $1
         AND expires_at > now()
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, SESSIONS_CAP] as never[],
    )) as RawSessionRow[];

    const accountRows = (await tx.unsafe(
      `SELECT id, provider_id, account_id, created_at
       FROM "_briven_auth_accounts"
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId] as never[],
    )) as RawAccountRow[];

    const auditRows = (await tx.unsafe(
      `SELECT id, action, occurred_at, metadata
       FROM "_briven_auth_audit_log"
       WHERE user_id = $1
       ORDER BY occurred_at DESC
       LIMIT $2`,
      [userId, AUDIT_CAP] as never[],
    )) as RawAuditRow[];

    return {
      id: user.id,
      emailDomainHint: domainHintFromEmail(user.email),
      nameInitial: nameInitialFrom(user.name),
      createdAt: user.created_at.toISOString(),
      sessions: sessionRows.map((s) => ({
        id: s.id,
        createdAt: s.created_at.toISOString(),
        expiresAt: s.expires_at.toISOString(),
        // IP tracking is disabled (privacy), so ip_address is null and this
        // hint is null. DTO key kept for dashboard stability.
        ipHashHint: s.ip_address ? s.ip_address.slice(0, 8) : null,
        userAgent: s.user_agent ? s.user_agent.slice(0, USER_AGENT_CAP) : null,
      })),
      accounts: accountRows.map((a) => ({
        id: a.id,
        providerId: a.provider_id,
        // DTO key kept stable for the dashboard; sourced from Better-Auth's
        // account_id column now.
        providerAccountId: a.account_id,
        createdAt: a.created_at.toISOString(),
      })),
      audit: auditRows.map((r) => ({
        id: r.id,
        action: r.action,
        occurredAt: r.occurred_at.toISOString(),
        metadata: r.metadata ?? {},
      })),
    };
  });
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

function formatCursor(args: { createdAt: string; id: string }): string {
  return `${args.createdAt}__${args.id}`;
}

function parseCursor(raw: string): { createdAt: string; id: string } {
  const sepAt = raw.indexOf('__');
  if (sepAt <= 0) {
    throw new ValidationError('invalid cursor', { cursor: raw });
  }
  const createdAt = raw.slice(0, sepAt);
  const id = raw.slice(sepAt + 2);
  if (!id) throw new ValidationError('invalid cursor', { cursor: raw });
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new ValidationError('invalid cursor', { cursor: raw });
  }
  return { createdAt, id };
}

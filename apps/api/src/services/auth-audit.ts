import { ValidationError } from '@briven/shared';

import { runInProjectSchema } from '../db/data-plane.js';

/**
 * Briven auth audit log reader.
 *
 * Reads `_briven_auth_audit_log` for a project. Same redaction rules as
 * the rest of the auth surface (CLAUDE.md §5.1): raw IP never surfaces;
 * the dashboard sees the first 8 chars of `ip_address_hash` as a stable
 * opaque correlation key. `user_agent` passes through (already truncated
 * to 512 chars at write time).
 *
 * Cursor pagination on `(occurred_at, id)` — descending so the most
 * recent entries come first.
 */

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export interface ListAuditOpts {
  readonly limit?: number;
  readonly cursor?: string | null;
  /** Filter by exact action (e.g. `signin`, `session.revoked`). */
  readonly action?: string | null;
  /** Filter to a single user's events. */
  readonly userId?: string | null;
}

export interface AuditEntry {
  id: string;
  userId: string | null;
  action: string;
  /** Opaque correlation key. Never the raw IP. */
  ipAddressHashHint: string | null;
  userAgent: string | null;
  /** Free-form context blob (provider id on signin, reason on revoke, etc). */
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface AuditListResult {
  items: AuditEntry[];
  nextCursor: string | null;
}

interface RawAuditRow {
  id: string;
  user_id: string | null;
  action: string;
  ip_address_hash: string | null;
  user_agent: string | null;
  metadata: unknown;
  occurred_at: Date;
}

/**
 * Mask the ip_address_hash to its first 8 chars — enough for an operator
 * to tell two distinct hashes apart in the dashboard without echoing the
 * full digest. The full hash stays on the server; truncation here means
 * a database leak of the dashboard's cached JSON still doesn't reveal
 * the full IP-correlation key.
 */
export function ipHashHint(raw: string | null): string | null {
  if (!raw) return null;
  return raw.slice(0, 8);
}

export function shapeAuditRow(row: {
  id: string;
  userId: string | null;
  action: string;
  ipAddressHash: string | null;
  userAgent: string | null;
  metadata: unknown;
  occurredAt: string;
}): AuditEntry {
  return {
    id: row.id,
    userId: row.userId,
    action: row.action,
    ipAddressHashHint: ipHashHint(row.ipAddressHash),
    userAgent: row.userAgent,
    metadata: isPlainObject(row.metadata) ? row.metadata : {},
    occurredAt: row.occurredAt,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export async function listAuditEntries(
  projectId: string,
  opts: ListAuditOpts = {},
): Promise<AuditListResult> {
  const limit = clamp(opts.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);

  const where: string[] = ['1=1'];
  const params: unknown[] = [];

  if (opts.cursor) {
    const parsed = parseCursor(opts.cursor);
    params.push(parsed.occurredAt, parsed.id);
    where.push(
      `(occurred_at, id) < ($${params.length - 1}::timestamptz, $${params.length})`,
    );
  }
  if (opts.action) {
    if (!/^[a-z0-9._-]{1,64}$/i.test(opts.action)) {
      throw new ValidationError('invalid action filter', { action: opts.action });
    }
    params.push(opts.action);
    where.push(`action = $${params.length}`);
  }
  if (opts.userId) {
    if (!/^[a-zA-Z0-9_]{1,64}$/.test(opts.userId)) {
      throw new ValidationError('invalid user id filter', { userId: opts.userId });
    }
    params.push(opts.userId);
    where.push(`user_id = $${params.length}`);
  }

  params.push(limit + 1);
  const limitPlaceholder = `$${params.length}`;

  const rows = await runInProjectSchema<RawAuditRow[]>(projectId, async (tx) => {
    return (await tx.unsafe(
      `
        SELECT id, user_id, action, ip_address_hash, user_agent, metadata, occurred_at
        FROM "_briven_auth_audit_log"
        WHERE ${where.join(' AND ')}
        ORDER BY occurred_at DESC, id DESC
        LIMIT ${limitPlaceholder}
      `,
      params as never[],
    )) as RawAuditRow[];
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const items = page.map((r) =>
    shapeAuditRow({
      id: r.id,
      userId: r.user_id,
      action: r.action,
      ipAddressHash: r.ip_address_hash,
      userAgent: r.user_agent,
      metadata: r.metadata,
      occurredAt: r.occurred_at.toISOString(),
    }),
  );

  const nextCursor = hasMore
    ? formatCursor({
        occurredAt: page[page.length - 1]!.occurred_at.toISOString(),
        id: page[page.length - 1]!.id,
      })
    : null;

  return { items, nextCursor };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

function formatCursor(args: { occurredAt: string; id: string }): string {
  return `${args.occurredAt}__${args.id}`;
}

function parseCursor(raw: string): { occurredAt: string; id: string } {
  const sepAt = raw.indexOf('__');
  if (sepAt <= 0) throw new ValidationError('invalid cursor', { cursor: raw });
  const occurredAt = raw.slice(0, sepAt);
  const id = raw.slice(sepAt + 2);
  if (!id) throw new ValidationError('invalid cursor', { cursor: raw });
  if (Number.isNaN(Date.parse(occurredAt))) {
    throw new ValidationError('invalid cursor', { cursor: raw });
  }
  return { occurredAt, id };
}

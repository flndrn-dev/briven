import { runInProjectDatabase } from '../db/data-plane.js';

/**
 * User security management — suspensions, bans, allowlist/blocklist,
 * waitlist, and email validation.
 *
 * All user-moderation state lives in `_briven_auth_user_security` (an
 * auxiliary table — we never ALTER the users table per DoltGres constraints).
 * Waitlist entries live in `_briven_auth_waitlist`.
 */

// ─── disposable email domains ─────────────────────────────────────────────

/** A small built-in set of known disposable domains. Expanded at runtime
 *  from a downloaded blocklist if available. */
const BUILT_IN_DISPOSABLE = new Set([
  'mailinator.com',
  'tempmail.com',
  'throwaway.com',
  'guerrillamail.com',
  'yopmail.com',
  'sharklasers.com',
  'getairmail.com',
  '10minutemail.com',
  'burnermail.io',
  'temp-mail.org',
  'fakeinbox.com',
  'mailnesia.com',
  'trashmail.com',
  'getnada.com',
  ' Mohmal.com',
  'maildrop.cc',
  'harakirimail.com',
  'spamgourmet.com',
  'mailcatch.com',
  'mytrashmail.com',
  'emailondeck.com',
  'dispostable.com',
]);

// ─── email validation helpers ─────────────────────────────────────────────

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function domainFromEmail(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1) : '';
}

function hasSubaddress(email: string): boolean {
  const local = email.split('@')[0] ?? '';
  return /[+#=]/.test(local);
}

function isDisposableDomain(domain: string): boolean {
  return BUILT_IN_DISPOSABLE.has(domain.toLowerCase());
}

// ─── allowlist / blocklist checks ─────────────────────────────────────────

export interface EmailGateResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check whether an email address passes the project's allowlist/blocklist
 * rules. Called BEFORE sign-up and BEFORE org invite acceptance.
 */
export function checkEmailGate(
  email: string,
  opts: {
    allowedDomains: string[];
    blockedDomains: string[];
    blockDisposable: boolean;
    blockSubaddresses: boolean;
  },
): EmailGateResult {
  const normalized = normalizeEmail(email);
  const domain = domainFromEmail(normalized);

  if (!domain) {
    return { allowed: false, reason: 'invalid email address' };
  }

  // Blocklist is checked first — explicit blocks override allows.
  if (opts.blockedDomains.length > 0) {
    const blocked = opts.blockedDomains.some(
      (d) => domain === d.toLowerCase() || normalized.endsWith(`@${d.toLowerCase()}`),
    );
    if (blocked) {
      return { allowed: false, reason: 'this email domain is not allowed' };
    }
  }

  if (opts.blockDisposable && isDisposableDomain(domain)) {
    return { allowed: false, reason: 'disposable email addresses are not allowed' };
  }

  if (opts.blockSubaddresses && hasSubaddress(normalized)) {
    return { allowed: false, reason: 'email subaddresses are not allowed' };
  }

  if (opts.allowedDomains.length > 0) {
    const allowed = opts.allowedDomains.some(
      (d) => domain === d.toLowerCase() || normalized.endsWith(`@${d.toLowerCase()}`),
    );
    if (!allowed) {
      return { allowed: false, reason: 'your email domain is not on the allowed list' };
    }
  }

  return { allowed: true };
}

// ─── user security state (bans / suspensions) ─────────────────────────────

export interface UserSecurityState {
  suspendedAt: Date | null;
  suspendedReason: string | null;
  bannedAt: Date | null;
  bannedReason: string | null;
  banExpiresAt: Date | null;
}

/**
 * Fetch the security state for a user. Returns null when no moderation
 * row exists (the common case — most users are unmoderated).
 */
export async function getUserSecurityState(
  projectId: string,
  userId: string,
): Promise<UserSecurityState | null> {
  const rows = await runInProjectDatabase<
    Array<{
      suspended_at: Date | null;
      suspended_reason: string | null;
      banned_at: Date | null;
      banned_reason: string | null;
      ban_expires_at: Date | null;
    }>
  >(projectId, async (tx) =>
    tx.unsafe(
      `SELECT suspended_at, suspended_reason, banned_at, banned_reason, ban_expires_at
       FROM "_briven_auth_user_security"
       WHERE user_id = $1
       LIMIT 1`,
      [userId] as never[],
    ) as never,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    suspendedAt: row.suspended_at,
    suspendedReason: row.suspended_reason,
    bannedAt: row.banned_at,
    bannedReason: row.banned_reason,
    banExpiresAt: row.ban_expires_at,
  };
}

/**
 * Is the user currently blocked from authentication? Checks both suspension
 * and ban (including expired bans).
 */
export function isUserBlocked(state: UserSecurityState | null): { blocked: boolean; reason?: string } {
  if (!state) return { blocked: false };

  // Permanent ban
  if (state.bannedAt && !state.banExpiresAt) {
    return { blocked: true, reason: state.bannedReason ?? 'account banned' };
  }

  // Temporary ban (check expiry)
  if (state.bannedAt && state.banExpiresAt) {
    if (new Date() < state.banExpiresAt) {
      return { blocked: true, reason: state.bannedReason ?? 'account temporarily banned' };
    }
  }

  // Suspension
  if (state.suspendedAt) {
    return { blocked: true, reason: state.suspendedReason ?? 'account suspended' };
  }

  return { blocked: false };
}

/**
 * Ban a user. Idempotent — re-banning updates the reason and timestamp.
 */
export async function banUser(
  projectId: string,
  userId: string,
  opts: { reason?: string; expiresAt?: Date },
): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    // Upsert: insert if absent, update if present.
    const existing = await tx.unsafe(
      `SELECT 1 FROM "_briven_auth_user_security" WHERE user_id = $1 LIMIT 1`,
      [userId] as never[],
    );
    const now = new Date().toISOString();
    const expires = opts.expiresAt ? opts.expiresAt.toISOString() : null;
    if ((existing as unknown[]).length > 0) {
      await tx.unsafe(
        `UPDATE "_briven_auth_user_security"
         SET banned_at = $2, banned_reason = $3, ban_expires_at = $4, updated_at = $2
         WHERE user_id = $1`,
        [userId, now, opts.reason ?? null, expires] as never,
      );
    } else {
      await tx.unsafe(
        `INSERT INTO "_briven_auth_user_security"
         (id, user_id, banned_at, banned_reason, ban_expires_at, created_at, updated_at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $2, $2)`,
        [userId, now, opts.reason ?? null, expires] as never,
      );
    }
  });
}

/**
 * Unban a user. Idempotent — no-op if the user was never banned.
 */
export async function unbanUser(projectId: string, userId: string): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `UPDATE "_briven_auth_user_security"
       SET banned_at = NULL, banned_reason = NULL, ban_expires_at = NULL, updated_at = $2
       WHERE user_id = $1`,
      [userId, new Date().toISOString()] as never,
    );
  });
}

/**
 * Suspend a user.
 */
export async function suspendUser(
  projectId: string,
  userId: string,
  opts: { reason?: string } = {},
): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    const existing = await tx.unsafe(
      `SELECT 1 FROM "_briven_auth_user_security" WHERE user_id = $1 LIMIT 1`,
      [userId] as never[],
    );
    const now = new Date().toISOString();
    if ((existing as unknown[]).length > 0) {
      await tx.unsafe(
        `UPDATE "_briven_auth_user_security"
         SET suspended_at = $2, suspended_reason = $3, updated_at = $2
         WHERE user_id = $1`,
        [userId, now, opts.reason ?? null] as never,
      );
    } else {
      await tx.unsafe(
        `INSERT INTO "_briven_auth_user_security"
         (id, user_id, suspended_at, suspended_reason, created_at, updated_at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $2, $2)`,
        [userId, now, opts.reason ?? null] as never,
      );
    }
  });
}

/**
 * Unsuspend a user.
 */
export async function unsuspendUser(projectId: string, userId: string): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `UPDATE "_briven_auth_user_security"
       SET suspended_at = NULL, suspended_reason = NULL, updated_at = $2
       WHERE user_id = $1`,
      [userId, new Date().toISOString()] as never,
    );
  });
}

// ─── waitlist ─────────────────────────────────────────────────────────────

export interface WaitlistEntry {
  id: string;
  email: string;
  name: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Date;
}

/**
 * Add an email to the waitlist. Idempotent — if the email already exists,
 * returns the existing row without overwriting.
 */
export async function addToWaitlist(
  projectId: string,
  input: { email: string; name?: string },
): Promise<WaitlistEntry> {
  const normalized = normalizeEmail(input.email);
  const rows = await runInProjectDatabase<
    Array<{ id: string; email: string; name: string | null; status: string; created_at: Date }>
  >(projectId, async (tx) => {
    // Try insert; on conflict (unique email) return existing.
    const inserted = await tx.unsafe(
      `INSERT INTO "_briven_auth_waitlist" (id, email, name, status, created_at, updated_at)
       VALUES (gen_random_uuid()::text, $1, $2, 'pending', now(), now())
       ON CONFLICT (email) DO UPDATE SET updated_at = now()
       RETURNING id, email, name, status, created_at`,
      [normalized, input.name ?? null] as never,
    );
    return inserted as never;
  });
  const row = rows[0];
  if (!row) throw new Error('waitlist insert returned no row');
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status as WaitlistEntry['status'],
    createdAt: row.created_at,
  };
}

/**
 * Check whether an email has been approved on the waitlist.
 */
export async function isWaitlistApproved(
  projectId: string,
  email: string,
): Promise<boolean> {
  const rows = await runInProjectDatabase<Array<{ status: string }>>(
    projectId,
    async (tx) =>
      tx.unsafe(
        `SELECT status FROM "_briven_auth_waitlist" WHERE email = $1 LIMIT 1`,
        [normalizeEmail(email)] as never,
      ) as never,
  );
  const row = rows[0];
  return row?.status === 'approved';
}

/**
 * Approve a waitlist entry by id.
 */
export async function approveWaitlistEntry(
  projectId: string,
  entryId: string,
  approvedBy: string,
): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `UPDATE "_briven_auth_waitlist"
       SET status = 'approved', approved_at = now(), approved_by = $2, updated_at = now()
       WHERE id = $1`,
      [entryId, approvedBy] as never,
    );
  });
}

/**
 * Reject a waitlist entry by id.
 */
export async function rejectWaitlistEntry(
  projectId: string,
  entryId: string,
  opts: { reason?: string } = {},
): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `UPDATE "_briven_auth_waitlist"
       SET status = 'rejected', rejected_at = now(), rejected_reason = $2, updated_at = now()
       WHERE id = $1`,
      [entryId, opts.reason ?? null] as never,
    );
  });
}

/**
 * List waitlist entries for the admin dashboard.
 */
export async function listWaitlist(
  projectId: string,
  opts: { status?: string; limit?: number; cursor?: string | null } = {},
): Promise<{ items: WaitlistEntry[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  // Build WHERE clauses with parameterized queries to avoid injection.
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.status) {
    conditions.push(`status = $${params.length + 1}`);
    params.push(opts.status);
  }

  if (opts.cursor) {
    const [createdAt, id] = opts.cursor.split('__');
    if (createdAt && id) {
      conditions.push(
        `(created_at < $${params.length + 1} OR (created_at = $${params.length + 1} AND id < $${params.length + 2}))`,
      );
      params.push(createdAt, id);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit + 1);
  const limitPlaceholder = `$${params.length}`;

  const rows = await runInProjectDatabase<
    Array<{
      id: string;
      email: string;
      name: string | null;
      status: string;
      created_at: Date;
    }>
  >(
    projectId,
    async (tx) =>
      tx.unsafe(
        `SELECT id, email, name, status, created_at
         FROM "_briven_auth_waitlist"
         ${whereClause}
         ORDER BY created_at DESC, id DESC
         LIMIT ${limitPlaceholder}`,
        params as never,
      ) as never,
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const items = page.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    status: r.status as WaitlistEntry['status'],
    createdAt: r.created_at,
  }));

  const nextCursor = hasMore
    ? `${page[page.length - 1]!.created_at.toISOString()}__${page[page.length - 1]!.id}`
    : null;

  return { items, nextCursor };
}

// ─── sign-up mode gate ────────────────────────────────────────────────────

export interface SignUpGateResult {
  allowed: boolean;
  reason?: string;
  waitlistEntry?: WaitlistEntry;
}

/**
 * The master sign-up gate. Combines signUpMode + email allowlist/blocklist
 * + waitlist status into a single decision.
 *
 * Called by the auth-tenant bridge BEFORE Better Auth processes sign-up.
 */
export async function checkSignUpGate(
  projectId: string,
  email: string,
  opts: {
    signUpMode: 'public' | 'restricted' | 'waitlist';
    allowedDomains: string[];
    blockedDomains: string[];
    blockDisposable: boolean;
    blockSubaddresses: boolean;
  },
): Promise<SignUpGateResult> {
  // 1. Email format / blocklist / allowlist.
  const emailGate = checkEmailGate(email, {
    allowedDomains: opts.allowedDomains,
    blockedDomains: opts.blockedDomains,
    blockDisposable: opts.blockDisposable,
    blockSubaddresses: opts.blockSubaddresses,
  });
  if (!emailGate.allowed) {
    return { allowed: false, reason: emailGate.reason };
  }

  // 2. Sign-up mode.
  if (opts.signUpMode === 'restricted') {
    return { allowed: false, reason: 'sign-ups are restricted to invited users only' };
  }

  if (opts.signUpMode === 'waitlist') {
    const approved = await isWaitlistApproved(projectId, email);
    if (!approved) {
      const entry = await addToWaitlist(projectId, { email });
      return {
        allowed: false,
        reason: 'you have been added to the waitlist. you will receive an email when approved.',
        waitlistEntry: entry,
      };
    }
  }

  return { allowed: true };
}

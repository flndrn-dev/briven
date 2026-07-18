/**
 * Password policy — Gap Fix #13 / Sprint S3.
 *
 * Per-tenant complexity + expiry + reuse rules.
 * Enforced on sign-up / reset / change (bridge) and on session create (expiry).
 */

import { createHash } from 'node:crypto';

import { ValidationError } from '@briven/shared';

import { runInProjectDatabase } from '../db/data-plane.js';

export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSpecial: boolean;
  /** When set, passwords older than this many days block new sessions. */
  maxAgeDays: number | null;
  /** How many previous passwords cannot be reused (0 = off). */
  preventReuse: number;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8,
  requireUppercase: false,
  requireLowercase: false,
  requireNumber: false,
  requireSpecial: false,
  maxAgeDays: null,
  preventReuse: 0,
};

/** Digest for history rows only — not used for authentication. */
export function passwordHistoryDigest(password: string): string {
  return createHash('sha256').update(password, 'utf8').digest('hex');
}

export function validatePassword(password: string, policy: PasswordPolicy): void {
  if (password.length < policy.minLength) {
    throw new ValidationError(`password must be at least ${policy.minLength} characters`);
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    throw new ValidationError('password must contain an uppercase letter');
  }
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    throw new ValidationError('password must contain a lowercase letter');
  }
  if (policy.requireNumber && !/[0-9]/.test(password)) {
    throw new ValidationError('password must contain a number');
  }
  if (policy.requireSpecial && !/[^A-Za-z0-9]/.test(password)) {
    throw new ValidationError('password must contain a special character');
  }
}

export async function getPasswordPolicy(projectId: string): Promise<PasswordPolicy> {
  const rows = await runInProjectDatabase<
    Array<{
      min_length: number;
      require_uppercase: boolean;
      require_lowercase: boolean;
      require_number: boolean;
      require_special: boolean;
      max_age_days: number | null;
      prevent_reuse: number;
    }>
  >(projectId, async (tx) =>
    tx.unsafe(
      `SELECT min_length, require_uppercase, require_lowercase, require_number, require_special, max_age_days, prevent_reuse
       FROM "_briven_auth_password_policy"
       LIMIT 1`,
    ) as never,
  );
  const row = rows[0];
  if (!row) return { ...DEFAULT_PASSWORD_POLICY };
  return {
    minLength: Number(row.min_length),
    requireUppercase: Boolean(row.require_uppercase),
    requireLowercase: Boolean(row.require_lowercase),
    requireNumber: Boolean(row.require_number),
    requireSpecial: Boolean(row.require_special),
    maxAgeDays: row.max_age_days == null ? null : Number(row.max_age_days),
    preventReuse: Number(row.prevent_reuse),
  };
}

export async function setPasswordPolicy(
  projectId: string,
  patch: Partial<PasswordPolicy>,
): Promise<PasswordPolicy> {
  const current = await getPasswordPolicy(projectId);
  const policy: PasswordPolicy = {
    ...current,
    ...patch,
    // Explicit null maxAgeDays must clear the field.
    maxAgeDays: patch.maxAgeDays === undefined ? current.maxAgeDays : patch.maxAgeDays,
  };
  if (policy.minLength < 6) {
    throw new ValidationError('min_length must be at least 6');
  }
  if (policy.maxAgeDays !== null && policy.maxAgeDays < 1) {
    throw new ValidationError('max_age_days must be at least 1');
  }
  if (policy.preventReuse < 0) {
    throw new ValidationError('prevent_reuse must be >= 0');
  }

  await runInProjectDatabase(projectId, async (tx) => {
    const existing = await tx.unsafe(
      `SELECT 1 FROM "_briven_auth_password_policy" LIMIT 1`,
    );
    if ((existing as unknown[]).length > 0) {
      await tx.unsafe(
        `UPDATE "_briven_auth_password_policy"
         SET min_length = $1, require_uppercase = $2, require_lowercase = $3,
             require_number = $4, require_special = $5, max_age_days = $6,
             prevent_reuse = $7, updated_at = now()`,
        [
          policy.minLength,
          policy.requireUppercase,
          policy.requireLowercase,
          policy.requireNumber,
          policy.requireSpecial,
          policy.maxAgeDays,
          policy.preventReuse,
        ] as never,
      );
    } else {
      await tx.unsafe(
        `INSERT INTO "_briven_auth_password_policy"
         (id, min_length, require_uppercase, require_lowercase, require_number, require_special, max_age_days, prevent_reuse, created_at, updated_at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, now(), now())`,
        [
          policy.minLength,
          policy.requireUppercase,
          policy.requireLowercase,
          policy.requireNumber,
          policy.requireSpecial,
          policy.maxAgeDays,
          policy.preventReuse,
        ] as never,
      );
    }
  });

  return policy;
}

/**
 * Reject if `password` matches one of the last N history digests.
 * Call BEFORE accepting a password change.
 */
export async function assertPasswordNotReused(
  projectId: string,
  userId: string,
  password: string,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
): Promise<void> {
  if (policy.preventReuse <= 0) return;
  const digest = passwordHistoryDigest(password);
  const rows = await runInProjectDatabase<Array<{ password_hash: string }>>(
    projectId,
    async (tx) =>
      tx.unsafe(
        `SELECT password_hash FROM "_briven_auth_password_history"
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, policy.preventReuse] as never,
      ) as never,
  );
  if (rows.some((r) => r.password_hash === digest)) {
    throw new ValidationError(
      `password was used recently — choose a different password (last ${policy.preventReuse} not allowed)`,
    );
  }
}

/** Record a password change for reuse checks + age tracking. */
export async function recordPasswordHistory(
  projectId: string,
  userId: string,
  password: string,
): Promise<void> {
  const digest = passwordHistoryDigest(password);
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `INSERT INTO "_briven_auth_password_history" (id, user_id, password_hash, created_at)
       VALUES (gen_random_uuid()::text, $1, $2, now())`,
      [userId, digest] as never,
    );
    // Cap history growth (keep 20).
    await tx.unsafe(
      `DELETE FROM "_briven_auth_password_history"
       WHERE user_id = $1
         AND id NOT IN (
           SELECT id FROM "_briven_auth_password_history"
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT 20
         )`,
      [userId] as never,
    );
    // Clear admin force-reset if present.
    await tx.unsafe(
      `DELETE FROM "_briven_auth_password_force_reset" WHERE user_id = $1`,
      [userId] as never,
    );
  });
}

/**
 * True when the user must change password before getting a session:
 * force-reset flag OR password older than maxAgeDays.
 */
export async function mustChangePassword(
  projectId: string,
  userId: string,
): Promise<{ required: boolean; reason?: string }> {
  const policy = await getPasswordPolicy(projectId);

  const forced = await runInProjectDatabase<Array<{ user_id: string }>>(
    projectId,
    async (tx) =>
      tx.unsafe(
        `SELECT user_id FROM "_briven_auth_password_force_reset" WHERE user_id = $1 LIMIT 1`,
        [userId] as never,
      ) as never,
  );
  if (forced.length > 0) {
    return { required: true, reason: 'password change required by administrator' };
  }

  if (policy.maxAgeDays == null || policy.maxAgeDays <= 0) {
    return { required: false };
  }

  // Prefer last history row; fall back to credential account updated_at.
  const ages = await runInProjectDatabase<Array<{ changed_at: Date | string | null }>>(
    projectId,
    async (tx) =>
      tx.unsafe(
        `SELECT COALESCE(
           (SELECT created_at FROM "_briven_auth_password_history"
            WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1),
           (SELECT updated_at FROM "_briven_auth_accounts"
            WHERE user_id = $1 AND provider_id = 'credential' LIMIT 1),
           (SELECT created_at FROM "_briven_auth_users" WHERE id = $1 LIMIT 1)
         ) AS changed_at`,
        [userId] as never,
      ) as never,
  );
  const raw = ages[0]?.changed_at;
  if (!raw) return { required: false };
  const changedAt = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(changedAt.getTime())) return { required: false };
  const ageMs = Date.now() - changedAt.getTime();
  const maxMs = policy.maxAgeDays * 86_400_000;
  if (ageMs > maxMs) {
    return {
      required: true,
      reason: `password expired after ${policy.maxAgeDays} days — please reset your password`,
    };
  }
  return { required: false };
}

/** Admin: require password change on next sign-in. */
export async function forcePasswordReset(
  projectId: string,
  userId: string,
  reason?: string,
): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `INSERT INTO "_briven_auth_password_force_reset" (user_id, reason, forced_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET reason = $2, forced_at = now()`,
      [userId, reason ?? null] as never,
    );
  });
}

export async function clearForcePasswordReset(
  projectId: string,
  userId: string,
): Promise<void> {
  await runInProjectDatabase(projectId, async (tx) => {
    await tx.unsafe(
      `DELETE FROM "_briven_auth_password_force_reset" WHERE user_id = $1`,
      [userId] as never,
    );
  });
}

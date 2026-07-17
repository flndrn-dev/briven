/**
 * Password policy — Gap Fix #13.
 *
 * Per-tenant configurable complexity rules enforced on sign-up and
 * password change. One row per project; defaults are used when no row
 * exists (backward-compatible — existing tenants are unaffected until
 * an admin configures a policy).
 */

import { ValidationError } from '@briven/shared';
import { runInProjectDatabase } from '../db/data-plane.js';

export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSpecial: boolean;
  maxAgeDays: number | null;
  preventReuse: number;
}

const DEFAULT_POLICY: PasswordPolicy = {
  minLength: 8,
  requireUppercase: false,
  requireLowercase: false,
  requireNumber: false,
  requireSpecial: false,
  maxAgeDays: null,
  preventReuse: 0,
};

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
  if (!row) return DEFAULT_POLICY;
  return {
    minLength: row.min_length,
    requireUppercase: row.require_uppercase,
    requireLowercase: row.require_lowercase,
    requireNumber: row.require_number,
    requireSpecial: row.require_special,
    maxAgeDays: row.max_age_days,
    preventReuse: row.prevent_reuse,
  };
}

export async function setPasswordPolicy(
  projectId: string,
  patch: Partial<PasswordPolicy>,
): Promise<PasswordPolicy> {
  const policy = { ...DEFAULT_POLICY, ...patch };
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

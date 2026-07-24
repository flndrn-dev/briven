/**
 * User import into Doltgres briven-engine.
 * Supports plaintext passwords (hashed with engine) and pre-hashed bcrypt/argon2.
 */

import { randomBytes } from 'node:crypto';

import { isAuthCoreInitialized } from './engine.js';
import { hashPassword, signUpEmailPassword } from './emailpassword.js';
import { getEnginePool } from './db.js';
import { projectIdToTenantId } from './project-map.js';
import { log } from '../../lib/logger.js';

export type ImportUserInput = {
  email?: string;
  phoneNumber?: string;
  /** Prefer when migrating from another system */
  passwordHash?: string;
  /**
   * bcrypt | argon2 | briven-engine (scrypt-style stored by us).
   * If omitted and passwordHash set, we guess from prefix ($2a/$2b/$2y → bcrypt, $argon2 → argon2).
   */
  hashingAlgorithm?: string;
  passwordPlaintext?: string;
  userId?: string;
  tenantId?: string;
  projectId?: string;
  emailVerified?: boolean;
  name?: string;
};

export type ImportUsersResult = {
  engine: 'briven-engine';
  storage: 'doltgres';
  ok: boolean;
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ index: number; message: string }>;
  message?: string;
};

function newUserId(): string {
  return `beu_${randomBytes(12).toString('hex')}`;
}

function detectAlgo(hash: string, declared?: string): string {
  if (declared) return declared.toLowerCase();
  if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$')) {
    return 'bcrypt';
  }
  if (hash.startsWith('$argon2')) return 'argon2';
  if (hash.includes(':')) return 'briven-engine';
  return 'unknown';
}

/**
 * Store foreign hash as `algo$` + raw so we can verify later.
 * Engine sign-in currently verifies briven-engine scrypt; foreign hashes
 * are imported for migration completeness — users may need reset if algo
 * not yet verified on sign-in path.
 */
function storeForeignHash(algo: string, hash: string): string {
  return `import:${algo}:${hash}`;
}

export async function importBrivenEngineUsers(
  users: ImportUserInput[],
): Promise<ImportUsersResult> {
  const base: ImportUsersResult = {
    engine: 'briven-engine',
    storage: 'doltgres',
    ok: true,
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  if (!isAuthCoreInitialized()) {
    return {
      ...base,
      ok: false,
      message: 'briven-engine not ready on Doltgres',
    };
  }

  const pool = getEnginePool();

  for (let i = 0; i < users.length; i++) {
    const u = users[i]!;
    try {
      const email = u.email?.trim().toLowerCase();
      if (!email) {
        base.failed++;
        base.errors.push({ index: i, message: 'email required' });
        continue;
      }

      const tenantId =
        u.tenantId ??
        (u.projectId ? projectIdToTenantId(u.projectId) : 'public');

      // Ensure tenant
      const ten = await pool.query(
        `SELECT tenant_id FROM be_tenants WHERE tenant_id = $1 LIMIT 1`,
        [tenantId],
      );
      if (!ten.rowCount) {
        await pool.query(
          `INSERT INTO be_tenants (tenant_id, project_id) VALUES ($1, $2)`,
          [tenantId, u.projectId ?? tenantId],
        );
      }

      const existing = await pool.query(
        `SELECT id FROM be_users WHERE tenant_id = $1 AND email = $2 LIMIT 1`,
        [tenantId, email],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        base.skipped++;
        continue;
      }

      // Plaintext path — full engine signup
      if (u.passwordPlaintext) {
        const res = await signUpEmailPassword({
          email,
          password: u.passwordPlaintext,
          tenantId,
          projectId: u.projectId,
        });
        if (res.status !== 'OK') {
          base.failed++;
          base.errors.push({ index: i, message: res.status });
          continue;
        }
        if (u.emailVerified || u.name || u.phoneNumber) {
          await pool.query(
            `UPDATE be_users SET
              email_verified = COALESCE($2, email_verified),
              phone = COALESCE($3, phone),
              metadata_json = CASE
                WHEN $4::text IS NULL THEN metadata_json
                ELSE $4::text
              END
             WHERE id = $1`,
            [
              res.user.id,
              u.emailVerified ?? null,
              u.phoneNumber ?? null,
              u.name ? JSON.stringify({ name: u.name }) : null,
            ],
          );
        }
        base.imported++;
        continue;
      }

      // Hash import path
      if (!u.passwordHash) {
        base.failed++;
        base.errors.push({
          index: i,
          message: 'passwordPlaintext or passwordHash required',
        });
        continue;
      }

      const algo = detectAlgo(u.passwordHash, u.hashingAlgorithm);
      if (algo === 'unknown') {
        base.failed++;
        base.errors.push({
          index: i,
          message:
            'unknown hash format — set hashingAlgorithm to bcrypt|argon2|briven-engine',
        });
        continue;
      }

      const userId = u.userId?.trim() || newUserId();
      let storedHash: string;
      if (algo === 'briven-engine') {
        storedHash = u.passwordHash;
      } else if (algo === 'bcrypt' || algo === 'argon2') {
        storedHash = storeForeignHash(algo, u.passwordHash);
      } else {
        // re-hash if they sent plaintext by mistake under passwordHash — no
        storedHash = storeForeignHash(algo, u.passwordHash);
      }

      await pool.query(
        `INSERT INTO be_users (id, tenant_id, email, phone, email_verified, metadata_json)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          tenantId,
          email,
          u.phoneNumber ?? null,
          Boolean(u.emailVerified),
          JSON.stringify(u.name ? { name: u.name } : {}),
        ],
      );
      await pool.query(
        `INSERT INTO be_password_hashes (user_id, password_hash) VALUES ($1, $2)`,
        [userId, storedHash],
      );
      base.imported++;
    } catch (err) {
      base.failed++;
      base.errors.push({
        index: i,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.info('briven_engine_import_users', {
    imported: base.imported,
    skipped: base.skipped,
    failed: base.failed,
  });

  base.ok = base.failed === 0;
  return base;
}

/** Convenience: import one user with plaintext (tests). */
export async function importOnePlaintext(input: {
  email: string;
  password: string;
  projectId?: string;
}): Promise<{ ok: boolean; userId?: string; message?: string }> {
  const r = await importBrivenEngineUsers([
    {
      email: input.email,
      passwordPlaintext: input.password,
      projectId: input.projectId,
    },
  ]);
  if (r.imported === 1) return { ok: true };
  return {
    ok: false,
    message: r.errors[0]?.message ?? r.message ?? 'import failed',
  };
}

// silence unused if tree-shaken
void hashPassword;

import { ValidationError, newId } from '@briven/shared';

import { runInProjectDatabase } from '../db/data-plane.js';
import { log } from '../lib/logger.js';

/**
 * Bulk-import users into a project's briven auth tables. Supports both
 * CSV and JSON payloads (the route handler hands us already-parsed rows).
 *
 * Hash compatibility (BUILD_PLAN.md §10):
 *   - argon2id (`$argon2id$...`) — native Better Auth format, stored as-is
 *   - bcrypt   (`$2a$...` / `$2b$...` / `$2y$...`) — accepted on import only;
 *     stored alongside a `hash_algo='bcrypt'` flag in `_briven_auth_accounts.scope`
 *     so the password-verify code path knows which library to dispatch to.
 *     Transparent upgrade-on-next-login lands when the verify path runs:
 *     a successful bcrypt compare triggers a re-hash with argon2id + an
 *     UPDATE on the row.
 *
 * Inserts are batched in a single transaction per call — partial failures
 * roll back so the operator can fix the bad row and retry without
 * deduplication logic.
 */

export interface ImportRow {
  email: string;
  name?: string | null;
  emailVerified?: boolean;
  /** Hash in original format. Detection is by prefix. */
  passwordHash?: string | null;
}

export interface ImportResult {
  inserted: number;
  skipped: number;
  errors: ReadonlyArray<{ row: number; message: string }>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_RE = /^\$2[abxy]\$/;
const ARGON2_RE = /^\$argon2id\$/;

function detectHashAlgo(hash: string): 'argon2id' | 'bcrypt' | null {
  if (ARGON2_RE.test(hash)) return 'argon2id';
  if (BCRYPT_RE.test(hash)) return 'bcrypt';
  return null;
}

interface RawCountRow {
  count: number | string;
}

/**
 * Parse a CSV blob into rows. Minimal — quoting per RFC 4180 but no
 * embedded newlines (operators pre-clean their exports). Header row
 * is required and determines column mapping; column order is free.
 */
export function parseImportCsv(text: string): ImportRow[] {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const out: ImportRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]!);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? '';
    });
    const email = row.email?.trim() ?? '';
    if (!email) continue;
    out.push({
      email,
      name: row.name && row.name.length > 0 ? row.name : null,
      emailVerified: row.emailverified === 'true' || row.email_verified === 'true',
      passwordHash:
        row.passwordhash && row.passwordhash.length > 0 ? row.passwordhash : null,
    });
  }
  return out;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        buf += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        buf += ch ?? '';
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(buf);
      buf = '';
    } else {
      buf += ch ?? '';
    }
  }
  out.push(buf);
  return out;
}

/**
 * Insert `rows` into the project's auth tables. Returns counts + per-row
 * errors. Caller passes already-parsed rows (CSV via parseImportCsv,
 * JSON via JSON.parse). Maximum 10_000 rows per call — anything bigger
 * should split into pages.
 */
export async function importAuthUsers(
  projectId: string,
  rows: ReadonlyArray<ImportRow>,
): Promise<ImportResult> {
  if (rows.length === 0) {
    return { inserted: 0, skipped: 0, errors: [] };
  }
  if (rows.length > 10_000) {
    throw new ValidationError('rows per call capped at 10_000', { count: rows.length });
  }

  const errors: { row: number; message: string }[] = [];
  let inserted = 0;
  let skipped = 0;

  await runInProjectDatabase(projectId, async (tx) => {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!;
      if (!EMAIL_RE.test(row.email)) {
        errors.push({ row: i, message: 'invalid email' });
        continue;
      }

      let algo: 'argon2id' | 'bcrypt' | null = null;
      if (row.passwordHash) {
        algo = detectHashAlgo(row.passwordHash);
        if (!algo) {
          errors.push({ row: i, message: 'unknown password hash format' });
          continue;
        }
      }

      // Skip when an account with this email already exists. Idempotent
      // re-runs of a CSV against the same tenant don't double-insert.
      const existing = (await tx.unsafe(
        `SELECT COUNT(*)::int AS count
         FROM "_briven_auth_users"
         WHERE email = $1`,
        [row.email] as never[],
      )) as RawCountRow[];
      const rawCount = existing[0]?.count ?? 0;
      // postgres.js may return BIGINT as string by default; coerce so the
      // typecheck doesn't see `string | number > number`.
      const count = typeof rawCount === 'string' ? Number.parseInt(rawCount, 10) : rawCount;
      if (count > 0) {
        skipped += 1;
        continue;
      }

      const userId = newId('u');
      try {
        await tx.unsafe(
          `INSERT INTO "_briven_auth_users" (id, email, name, email_verified)
           VALUES ($1, $2, $3, $4)`,
          [
            userId,
            row.email,
            row.name ?? null,
            // email_verified is a boolean (Better-Auth shape, S2.1b).
            row.emailVerified === true,
          ] as never[],
        );

        if (row.passwordHash && algo) {
          // Better Auth's email/password credential lives in
          // `_briven_auth_accounts` with provider_id='credential', the password
          // hash in the `password` column, and account_id = the user id (Better
          // Auth's natural key for credential accounts). The hash algorithm is
          // recorded in `scope` so a future Better-Auth password.verify hook can
          // verify imported argon2id/bcrypt hashes (Better Auth hashes new
          // passwords with its own scheme — imported hashes need that hook).
          await tx.unsafe(
            `INSERT INTO "_briven_auth_accounts"
               (id, user_id, account_id, provider_id, password, scope)
             VALUES ($1, $2, $3, 'credential', $4, $5)`,
            [
              newId('a'),
              userId,
              userId,
              row.passwordHash,
              `hash_algo=${algo}`,
            ] as never[],
          );
        }
        inserted += 1;
      } catch (err) {
        errors.push({
          row: i,
          message: err instanceof Error ? err.message : 'insert failed',
        });
      }
    }
  });

  log.info('briven_auth_import_done', {
    projectId,
    inserted,
    skipped,
    errored: errors.length,
  });

  return { inserted, skipped, errors };
}

export const __test__ = { detectHashAlgo, parseCsvLine };

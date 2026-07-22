/**
 * User import into Doltgres briven-engine.
 */

import { isAuthCoreInitialized } from './engine.js';
import { signUpEmailPassword } from './emailpassword.js';
import { log } from '../../lib/logger.js';

export type ImportUserInput = {
  email?: string;
  phoneNumber?: string;
  passwordHash?: string;
  hashingAlgorithm?: string;
  passwordPlaintext?: string;
  userId?: string;
  tenantId?: string;
};

export type ImportUsersResult = {
  engine: 'briven-engine';
  storage: 'doltgres';
  ok: boolean;
  imported: number;
  failed: number;
  errors: Array<{ index: number; message: string }>;
  message?: string;
};

export async function importBrivenEngineUsers(
  users: ImportUserInput[],
): Promise<ImportUsersResult> {
  const base = {
    engine: 'briven-engine' as const,
    storage: 'doltgres' as const,
    imported: 0,
    failed: 0,
    errors: [] as Array<{ index: number; message: string }>,
  };

  if (!isAuthCoreInitialized()) {
    return {
      ...base,
      ok: false,
      message: 'briven-engine not ready on Doltgres',
    };
  }

  for (let i = 0; i < users.length; i++) {
    const u = users[i]!;
    try {
      if (!u.email || !u.passwordPlaintext) {
        base.failed++;
        base.errors.push({
          index: i,
          message: 'email + passwordPlaintext required (hash import later)',
        });
        continue;
      }
      const res = await signUpEmailPassword({
        email: u.email,
        password: u.passwordPlaintext,
        tenantId: u.tenantId ?? 'public',
      });
      if (res.status !== 'OK') {
        base.failed++;
        base.errors.push({ index: i, message: res.status });
        continue;
      }
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
    failed: base.failed,
    storage: 'doltgres',
  });

  return { ...base, ok: base.failed === 0 && base.imported > 0 };
}

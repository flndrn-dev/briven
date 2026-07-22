/**
 * briven-engine — Briven Auth vault (DOLTGRES ONLY).
 *
 * HARD RULE: the complete Briven project is Doltgres. New parts do not get
 * stock Postgres. There is NO SuperTokens Core process and NO separate
 * Postgres for Auth.
 *
 * briven-engine = this API package + tables in Doltgres database `briven_engine`.
 * Recipe *behavior* still follows the SuperTokens feature checklist as docs,
 * but all state is native Doltgres.
 *
 * Platform operator sign-in (routes/auth.ts Better Auth on briven_control)
 * is separate and also on Doltgres.
 *
 * DEPLOY GATE: local build only until complete product + flndrn OK.
 */

import { log } from '../../lib/logger.js';
import { env } from '../../env.js';
import { ensureBrivenEngineDatabase } from './ensure-db.js';
import { bootstrapBrivenEngineSchema } from './schema.js';
import { getEnginePool, isEnginePoolReady } from './db.js';

export const BRIVEN_ENGINE_ID = 'briven-engine' as const;

export type AuthCoreStatus = {
  enabled: boolean;
  engine: typeof BRIVEN_ENGINE_ID;
  storage: 'doltgres';
  database: 'briven_engine';
  ok: boolean;
  schemaReady: boolean;
  poolReady: boolean;
  phase: number;
  message: string;
  deployGate: 'local-build-only-until-complete';
  recipeNames: string[];
  sdkInitialized: boolean;
  recipePhase: number | null;
  connectionUri: string;
  hello: string | null;
  apiVersion: string | null;
};

let schemaReady = false;
let bootstrapped = false;

const LOADED_RECIPES = [
  'session',
  'emailpassword',
  'passwordless',
  'thirdparty',
  'webauthn',
  'multifactorauth',
  'usermetadata',
] as const;

/**
 * Probe + ensure Doltgres Auth vault is ready.
 */
export async function probeBrivenEngine(): Promise<AuthCoreStatus> {
  const base = {
    engine: BRIVEN_ENGINE_ID,
    storage: 'doltgres' as const,
    database: 'briven_engine' as const,
    deployGate: 'local-build-only-until-complete' as const,
    recipeNames: [...LOADED_RECIPES],
    sdkInitialized: bootstrapped && schemaReady,
    recipePhase: bootstrapped ? 3 : null,
    connectionUri: env.BRIVEN_ENGINE_DATABASE_URL ?? '(unset)',
    hello: null as string | null,
    apiVersion: null as string | null,
  };

  if (!env.BRIVEN_AUTH_CORE_ENABLED) {
    return {
      ...base,
      enabled: false,
      ok: false,
      schemaReady: false,
      poolReady: false,
      phase: 1,
      message: 'BRIVEN_AUTH_CORE_ENABLED is false',
    };
  }

  try {
    if (!isEnginePoolReady()) {
      return {
        ...base,
        enabled: true,
        ok: false,
        schemaReady,
        poolReady: false,
        phase: 1,
        message: 'Doltgres engine pool not ready — call initAuthCoreSdk at boot',
      };
    }

    const pool = getEnginePool();
    const r = await pool.query('SELECT 1 AS ok');
    const ok = r.rows[0]?.ok === 1 || r.rows[0]?.ok === '1';
    return {
      ...base,
      enabled: true,
      ok: ok && schemaReady,
      schemaReady,
      poolReady: true,
      phase: schemaReady ? 3 : 1,
      hello: ok ? 'Hello' : null,
      message: schemaReady
        ? 'briven-engine ready on Doltgres'
        : 'Doltgres reachable; schema not bootstrapped',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('briven_engine_probe_failed', { message });
    return {
      ...base,
      enabled: true,
      ok: false,
      schemaReady,
      poolReady: false,
      phase: 1,
      message: `Doltgres unreachable: ${message}`,
    };
  }
}

/** @deprecated name kept for old imports */
export const probeSuperTokensCore = probeBrivenEngine;

/**
 * Boot briven-engine: ensure Doltgres DB + schema. No SuperTokens Core.
 */
export async function initAuthCoreSdk(): Promise<boolean> {
  if (bootstrapped && schemaReady) return true;
  if (!env.BRIVEN_AUTH_CORE_ENABLED) return false;

  try {
    const ensured = await ensureBrivenEngineDatabase();
    if (!ensured.ok) {
      log.error('briven_engine_init_db_failed', ensured);
      return false;
    }

    const { openEnginePool } = await import('./db.js');
    openEnginePool();
    await bootstrapBrivenEngineSchema();
    schemaReady = true;
    bootstrapped = true;

    log.info('briven_engine_initialized', {
      engine: BRIVEN_ENGINE_ID,
      storage: 'doltgres',
      database: 'briven_engine',
      recipes: LOADED_RECIPES,
      deployGate: 'local-build-only-until-complete',
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('briven_engine_init_failed', { message });
    return false;
  }
}

export function isAuthCoreInitialized(): boolean {
  return bootstrapped && schemaReady;
}

export function getAuthCoreRecipeMeta(): {
  phase: number | null;
  names: string[];
} {
  return {
    phase: bootstrapped ? 3 : null,
    names: bootstrapped ? [...LOADED_RECIPES] : [],
  };
}

/**
 * Yellow Authentication dashboard data — all from Doltgres briven-engine.
 */

import { getEnginePool } from './db.js';
import {
  BRIVEN_ENGINE_ID,
  getAuthCoreRecipeMeta,
  isAuthCoreInitialized,
  probeBrivenEngine,
} from './engine.js';
import { BRIVEN_ENGINE_RECIPE_CATALOG, getRecipePhase } from './recipes.js';
import { listBrivenEngineUsers } from './users.js';

export type BrivenEngineDashboard = {
  engine: typeof BRIVEN_ENGINE_ID;
  storage: 'doltgres';
  database: 'briven_engine';
  ok: boolean;
  message: string;
  counts: {
    users: number;
    sessions: number;
    tenants: number;
    thirdPartyLinks: number;
    passwordlessCodesActive: number;
  };
  methods: {
    emailPassword: boolean;
    passwordlessEmail: boolean;
    passwordlessSms: boolean;
    google: boolean;
    github: boolean;
    webauthn: boolean;
    mfa: boolean;
  };
  recentUsers: Array<{
    id: string;
    emails: string[];
    phoneNumbers: string[];
    tenantId?: string;
    timeJoined: number;
  }>;
  recipesLoaded: string[];
  recipePhase: number | null;
};

export async function getBrivenEngineDashboard(): Promise<BrivenEngineDashboard> {
  const probe = await probeBrivenEngine();
  const meta = getAuthCoreRecipeMeta();
  const phase = getRecipePhase();
  const names = new Set(meta.names.length ? meta.names : BRIVEN_ENGINE_RECIPE_CATALOG.filter((r) => r.phase <= phase).map((r) => r.id));

  const baseMethods = {
    emailPassword: names.has('emailpassword'),
    passwordlessEmail: names.has('passwordless'),
    passwordlessSms: names.has('passwordless'),
    google: names.has('thirdparty'),
    github: names.has('thirdparty'),
    webauthn: names.has('webauthn'),
    mfa: names.has('multifactorauth'),
  };

  if (!isAuthCoreInitialized() || !probe.ok) {
    return {
      engine: BRIVEN_ENGINE_ID,
      storage: 'doltgres',
      database: 'briven_engine',
      ok: false,
      message: probe.message,
      counts: {
        users: 0,
        sessions: 0,
        tenants: 0,
        thirdPartyLinks: 0,
        passwordlessCodesActive: 0,
      },
      methods: baseMethods,
      recentUsers: [],
      recipesLoaded: meta.names,
      recipePhase: meta.phase,
    };
  }

  const pool = getEnginePool();
  const [usersC, sessionsC, tenantsC, linksC, codesC] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n FROM be_users`),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM be_sessions WHERE expires_at > NOW()`,
    ),
    pool.query(`SELECT COUNT(*)::int AS n FROM be_tenants`),
    pool.query(`SELECT COUNT(*)::int AS n FROM be_third_party_links`),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM be_passwordless_codes WHERE expires_at > NOW()`,
    ),
  ]);

  const listed = await listBrivenEngineUsers({ limit: 20 });

  return {
    engine: BRIVEN_ENGINE_ID,
    storage: 'doltgres',
    database: 'briven_engine',
    ok: true,
    message: 'dashboard data from Doltgres',
    counts: {
      users: (usersC.rows[0] as { n: number }).n,
      sessions: (sessionsC.rows[0] as { n: number }).n,
      tenants: (tenantsC.rows[0] as { n: number }).n,
      thirdPartyLinks: (linksC.rows[0] as { n: number }).n,
      passwordlessCodesActive: (codesC.rows[0] as { n: number }).n,
    },
    methods: baseMethods,
    recentUsers: listed.users.map((u) => ({
      id: u.id,
      emails: u.emails,
      phoneNumbers: u.phoneNumbers,
      timeJoined: u.timeJoined,
    })),
    recipesLoaded: meta.names,
    recipePhase: meta.phase,
  };
}

/**
 * briven-engine recipe catalog + status APIs.
 *
 *  GET /v1/auth-core/recipes          — full catalog + loaded names
 *  GET /v1/auth-core/providers        — social provider catalog
 *  GET /v1/auth-core/delivery         — email/SMS delivery status
 */

import { Hono } from 'hono';

import {
  BRIVEN_ENGINE_ID,
  getAuthCoreRecipeMeta,
  isAuthCoreInitialized,
  probeBrivenEngine,
} from '../services/auth-core/engine.js';
import {
  BRIVEN_ENGINE_RECIPE_CATALOG,
  getRecipePhase,
} from '../services/auth-core/recipes.js';
import { BRIVEN_ENGINE_SOCIAL_CATALOG } from '../services/auth-core/providers.js';
import type { AppEnv } from '../types/app-env.js';

export const authCoreRecipesRouter = new Hono<AppEnv>();

authCoreRecipesRouter.get('/v1/auth-core/recipes', async (c) => {
  const meta = getAuthCoreRecipeMeta();
  const phase = getRecipePhase();
  const core = await probeBrivenEngine();

  const catalog = BRIVEN_ENGINE_RECIPE_CATALOG.map((r) => ({
    ...r,
    loaded: meta.names.includes(r.id),
    availableInPhase: r.phase <= phase,
  }));

  return c.json({
    engine: BRIVEN_ENGINE_ID,
    product: 'Briven Auth',
    sdkInitialized: isAuthCoreInitialized(),
    recipePhase: meta.phase ?? phase,
    loaded: meta.names,
    smsIncluded: meta.names.includes('passwordless'),
    catalog,
    core: {
      ok: core.ok,
      message: core.message,
      hello: core.hello,
    },
    deployGate: 'local-build-only-until-complete',
  });
});

authCoreRecipesRouter.get('/v1/auth-core/providers', (c) => {
  return c.json({
    engine: BRIVEN_ENGINE_ID,
    product: 'Briven Auth',
    providers: BRIVEN_ENGINE_SOCIAL_CATALOG,
    note: 'Secrets are per-project; empty credentials means provider is listed but not live for that project yet.',
  });
});

authCoreRecipesRouter.get('/v1/auth-core/delivery', (c) => {
  return c.json({
    engine: BRIVEN_ENGINE_ID,
    email: {
      enabled: true,
      modes: ['log', 'platform', 'provider'],
      status: 'briven-engine delivery hook wired (passwordless + future reset/verify)',
    },
    sms: {
      enabled: true,
      includedInPlan: true,
      modes: ['log', 'provider'],
      status: 'briven-engine SMS OTP via passwordless EMAIL_OR_PHONE',
    },
  });
});

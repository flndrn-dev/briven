/**
 * briven-engine login methods summary for apps / dashboard.
 *
 *  GET /v1/auth-core/loginmethods
 *  GET /v1/auth-core/projects/:projectId/loginmethods
 */

import { Hono } from 'hono';

import {
  BRIVEN_ENGINE_ID,
  getAuthCoreRecipeMeta,
  isAuthCoreInitialized,
} from '../services/auth-core/engine.js';
import { getBrivenEngineProjectConfig } from '../services/auth-core/project-config.js';
import type { AppEnv } from '../types/app-env.js';

export const authCoreLoginMethodsRouter = new Hono<AppEnv>();

function globalMethods() {
  const meta = getAuthCoreRecipeMeta();
  const names = new Set(meta.names);
  return {
    engine: BRIVEN_ENGINE_ID,
    sdkInitialized: isAuthCoreInitialized(),
    emailPassword: names.has('emailpassword'),
    passwordlessEmail: names.has('passwordless'),
    passwordlessSms: names.has('passwordless'),
    thirdParty: names.has('thirdparty'),
    webauthn: names.has('webauthn'),
    mfa: names.has('multifactorauth'),
    totp: names.has('totp'),
  };
}

authCoreLoginMethodsRouter.get('/v1/auth-core/loginmethods', (c) => {
  return c.json(globalMethods());
});

authCoreLoginMethodsRouter.get(
  '/v1/auth-core/projects/:projectId/loginmethods',
  async (c) => {
    const projectId = c.req.param('projectId');
    const base = globalMethods();
    try {
      const config = await getBrivenEngineProjectConfig(projectId);
      const configuredProviders = config.providers
        .filter((p) => p.configured)
        .map((p) => p.thirdPartyId);
      return c.json({
        ...base,
        projectId,
        tenantId: config.tenantId,
        thirdPartyProvidersConfigured: configuredProviders,
        smsProviderConfigured: config.delivery.sms.configured,
        emailProviderConfigured: config.delivery.email.configured,
      });
    } catch (err) {
      return c.json({
        ...base,
        projectId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

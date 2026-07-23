/**
 * briven-engine per-project config + multitenancy + MFA + passkeys.
 * Project routes: dashboard session + project admin.
 * MFA/passkey admin: dashboard session.
 * DOLTGRES ONLY.
 */

import { Hono } from 'hono';

import {
  requireAuthCoreDashboard,
  requireAuthCoreProject,
} from '../middleware/auth-core-guard.js';
import { BRIVEN_ENGINE_ID, isAuthCoreInitialized } from '../services/auth-core/engine.js';
import {
  getBrivenEngineProjectConfig,
  setBrivenEngineMethodFlags,
  setBrivenEngineProviderSecrets,
  setBrivenEngineSmsSecrets,
  type BrivenEngineMethodFlags,
} from '../services/auth-core/project-config.js';
import { env } from '../env.js';
import {
  ensureBrivenEngineTenant,
  listBrivenEngineTenants,
} from '../services/auth-core/multitenancy.js';
import {
  assignBrivenEngineRole,
  createBrivenEngineRole,
  getBrivenEngineUserRoles,
  listBrivenEngineRoles,
} from '../services/auth-core/roles.js';
import {
  createTotpDevice,
  listTotpDevices,
  removeTotpDevice,
  verifyAndEnableTotpDevice,
  verifyUserTotp,
} from '../services/auth-core/mfa.js';
import {
  createAuthenticationOptions,
  createRegistrationOptions,
  deletePasskey,
  finishAuthentication,
  finishRegistration,
  listPasskeys,
} from '../services/auth-core/webauthn.js';
import {
  BRIVEN_ENGINE_SOCIAL_CATALOG,
  type BrivenSocialProviderId,
} from '../services/auth-core/providers.js';
import type { AppEnv } from '../types/app-env.js';

const SOCIAL_IDS = new Set(
  BRIVEN_ENGINE_SOCIAL_CATALOG.map((p) => p.thirdPartyId),
);

export const authCoreProjectRouter = new Hono<AppEnv>();

authCoreProjectRouter.use(
  '/v1/auth-core/projects/:projectId/*',
  ...requireAuthCoreProject('admin'),
);
authCoreProjectRouter.use('/v1/auth-core/tenants', requireAuthCoreDashboard());
authCoreProjectRouter.use('/v1/auth-core/roles', requireAuthCoreDashboard());
authCoreProjectRouter.use('/v1/auth-core/roles/*', requireAuthCoreDashboard());
authCoreProjectRouter.use('/v1/auth-core/mfa/*', requireAuthCoreDashboard());
authCoreProjectRouter.use('/v1/auth-core/passkeys/*', requireAuthCoreDashboard());
authCoreProjectRouter.use('/v1/auth-core/users/*/roles', requireAuthCoreDashboard());

authCoreProjectRouter.get('/v1/auth-core/projects/:projectId/config', async (c) => {
  const projectId = c.req.param('projectId');
  try {
    const config = await getBrivenEngineProjectConfig(projectId);
    return c.json(config);
  } catch (err) {
    return c.json(
      {
        engine: BRIVEN_ENGINE_ID,
        code: 'config_error',
        message: err instanceof Error ? err.message : String(err),
      },
      400,
    );
  }
});

authCoreProjectRouter.put(
  '/v1/auth-core/projects/:projectId/providers/:thirdPartyId',
  async (c) => {
    const projectId = c.req.param('projectId');
    const thirdPartyIdRaw = c.req.param('thirdPartyId');
    const thirdPartyId = thirdPartyIdRaw as BrivenSocialProviderId;
    if (!SOCIAL_IDS.has(thirdPartyId)) {
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'bad_request',
          message: `unknown OAuth provider: ${thirdPartyIdRaw}`,
        },
        400,
      );
    }
    let body: {
      clientId?: string;
      clientSecret?: string;
      additionalConfig?: Record<string, string>;
    } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const clientId = body.clientId?.trim() ?? '';
    const clientSecret = body.clientSecret?.trim() ?? '';
    if (!clientId || !clientSecret) {
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'bad_request',
          message: 'clientId and clientSecret required (both non-empty)',
        },
        400,
      );
    }
    try {
      const result = await setBrivenEngineProviderSecrets(projectId, {
        thirdPartyId,
        clientId,
        clientSecret,
        additionalConfig: body.additionalConfig,
      });
      // Return public config so UI can show “configured”
      const config = await getBrivenEngineProjectConfig(projectId);
      const saved = config.providers.find((p) => p.thirdPartyId === thirdPartyId);
      return c.json({
        ...result,
        config,
        savedProvider: saved ?? null,
        apiOrigin: env.BRIVEN_API_ORIGIN,
      });
    } catch (err) {
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'save_failed',
          message: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }
  },
);

/** Toggle which sign-in methods this project uses. */
authCoreProjectRouter.put(
  '/v1/auth-core/projects/:projectId/methods',
  async (c) => {
    const projectId = c.req.param('projectId');
    let body: Partial<BrivenEngineMethodFlags> = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    try {
      const result = await setBrivenEngineMethodFlags(projectId, body);
      const config = await getBrivenEngineProjectConfig(projectId);
      return c.json({ ...result, config });
    } catch (err) {
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'save_failed',
          message: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }
  },
);

authCoreProjectRouter.put(
  '/v1/auth-core/projects/:projectId/delivery/sms',
  async (c) => {
    const projectId = c.req.param('projectId');
    let body: {
      accountSid?: string;
      authToken?: string;
      fromNumber?: string;
    } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    if (!body.accountSid || !body.authToken || !body.fromNumber) {
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'bad_request',
          message: 'accountSid, authToken, fromNumber required',
        },
        400,
      );
    }
    try {
      const result = await setBrivenEngineSmsSecrets(projectId, {
        accountSid: body.accountSid,
        authToken: body.authToken,
        fromNumber: body.fromNumber,
      });
      const config = await getBrivenEngineProjectConfig(projectId);
      return c.json({ ...result, config });
    } catch (err) {
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'save_failed',
          message: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }
  },
);

authCoreProjectRouter.post(
  '/v1/auth-core/projects/:projectId/tenant',
  async (c) => {
    const projectId = c.req.param('projectId');
    const result = await ensureBrivenEngineTenant(projectId);
    return c.json(result, result.ok ? 200 : 503);
  },
);

authCoreProjectRouter.get('/v1/auth-core/tenants', async (c) => {
  const result = await listBrivenEngineTenants();
  return c.json(result, result.ok ? 200 : 503);
});

authCoreProjectRouter.get('/v1/auth-core/roles', async (c) => {
  return c.json(await listBrivenEngineRoles());
});

authCoreProjectRouter.post('/v1/auth-core/roles', async (c) => {
  let body: {
    role?: string;
    permissions?: string[];
    projectId?: string;
    tenantId?: string;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (!body.role) {
    return c.json({ engine: BRIVEN_ENGINE_ID, code: 'role_required' }, 400);
  }
  return c.json(
    await createBrivenEngineRole(body.role, body.permissions ?? [], {
      projectId: body.projectId,
      tenantId: body.tenantId,
    }),
  );
});

authCoreProjectRouter.post('/v1/auth-core/roles/assign', async (c) => {
  let body: {
    userId?: string;
    role?: string;
    projectId?: string;
    tenantId?: string;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (!body.userId || !body.role) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, code: 'userId_and_role_required' },
      400,
    );
  }
  return c.json(
    await assignBrivenEngineRole(body.userId, body.role, {
      projectId: body.projectId,
      tenantId: body.tenantId,
    }),
  );
});

authCoreProjectRouter.get('/v1/auth-core/users/:userId/roles', async (c) => {
  return c.json(
    await getBrivenEngineUserRoles(c.req.param('userId'), {
      projectId: c.req.query('projectId') ?? undefined,
      tenantId: c.req.query('tenantId') ?? undefined,
    }),
  );
});

authCoreProjectRouter.get('/v1/auth-core/roles/list', async (c) => {
  return c.json(
    await listBrivenEngineRoles({
      projectId: c.req.query('projectId') ?? undefined,
      tenantId: c.req.query('tenantId') ?? undefined,
    }),
  );
});
// ─── MFA TOTP ───────────────────────────────────────────────────────
authCoreProjectRouter.post('/v1/auth-core/mfa/totp', async (c) => {
  if (!isAuthCoreInitialized()) {
    return c.json({ engine: BRIVEN_ENGINE_ID, code: 'sdk_not_ready' }, 503);
  }
  let body: {
    userId?: string;
    deviceName?: string;
    projectId?: string;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (!body.userId) {
    return c.json({ engine: BRIVEN_ENGINE_ID, code: 'userId_required' }, 400);
  }
  const result = await createTotpDevice(
    body.userId,
    body.deviceName ?? 'default',
    { projectId: body.projectId },
  );
  return c.json(result, result.ok ? 200 : 400);
});

authCoreProjectRouter.post('/v1/auth-core/mfa/totp/verify', async (c) => {
  let body: {
    userId?: string;
    deviceId?: string;
    deviceName?: string;
    code?: string;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (!body.userId || !body.code) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, code: 'userId_and_code_required' },
      400,
    );
  }
  const result = await verifyAndEnableTotpDevice({
    userId: body.userId,
    deviceId: body.deviceId,
    deviceName: body.deviceName,
    code: body.code,
  });
  return c.json(result, result.ok ? 200 : 400);
});

authCoreProjectRouter.post('/v1/auth-core/mfa/totp/check', async (c) => {
  let body: { userId?: string; code?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (!body.userId || !body.code) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, code: 'userId_and_code_required' },
      400,
    );
  }
  return c.json(await verifyUserTotp(body.userId, body.code));
});

authCoreProjectRouter.get('/v1/auth-core/mfa/totp/:userId', async (c) => {
  return c.json(await listTotpDevices(c.req.param('userId')));
});

authCoreProjectRouter.delete(
  '/v1/auth-core/mfa/totp/:userId/:deviceName',
  async (c) => {
    return c.json(
      await removeTotpDevice(c.req.param('userId'), c.req.param('deviceName')),
    );
  },
);

// ─── Passkeys ───────────────────────────────────────────────────────
authCoreProjectRouter.post('/v1/auth-core/passkeys/register/options', async (c) => {
  let body: { userId?: string; userName?: string; projectId?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (!body.userId || !body.userName) {
    return c.json(
      { engine: BRIVEN_ENGINE_ID, code: 'userId_and_userName_required' },
      400,
    );
  }
  const result = await createRegistrationOptions({
    userId: body.userId,
    userName: body.userName,
    projectId: body.projectId,
  });
  return c.json(result, result.status === 'OK' ? 200 : 400);
});

authCoreProjectRouter.post('/v1/auth-core/passkeys/register/finish', async (c) => {
  let body: {
    userId?: string;
    challengeId?: string;
    credentialId?: string;
    publicKey?: string;
    transports?: string[];
    response?: unknown;
    expectedOrigin?: string;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (!body.userId || !body.challengeId) {
    return c.json({ engine: BRIVEN_ENGINE_ID, code: 'bad_request' }, 400);
  }
  if (!body.response && (!body.credentialId || !body.publicKey)) {
    return c.json(
      {
        engine: BRIVEN_ENGINE_ID,
        code: 'bad_request',
        message: 'response (WebAuthn JSON) or credentialId+publicKey required',
      },
      400,
    );
  }
  const result = await finishRegistration({
    userId: body.userId,
    challengeId: body.challengeId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response: body.response as any,
    credentialId: body.credentialId,
    publicKey: body.publicKey,
    transports: body.transports,
    expectedOrigin: body.expectedOrigin,
  });
  return c.json(result, result.status === 'OK' ? 200 : 400);
});

authCoreProjectRouter.post('/v1/auth-core/passkeys/authenticate/options', async (c) => {
  let body: { userId?: string; projectId?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const result = await createAuthenticationOptions({
    userId: body.userId,
    projectId: body.projectId,
  });
  return c.json(result, result.status === 'OK' ? 200 : 400);
});

authCoreProjectRouter.post('/v1/auth-core/passkeys/authenticate/finish', async (c) => {
  let body: {
    challengeId?: string;
    credentialId?: string;
    projectId?: string;
    response?: unknown;
    expectedOrigin?: string;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (!body.challengeId) {
    return c.json({ engine: BRIVEN_ENGINE_ID, code: 'bad_request' }, 400);
  }
  if (!body.response && !body.credentialId) {
    return c.json(
      {
        engine: BRIVEN_ENGINE_ID,
        code: 'bad_request',
        message: 'response or credentialId required',
      },
      400,
    );
  }
  const result = await finishAuthentication({
    challengeId: body.challengeId,
    credentialId: body.credentialId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response: body.response as any,
    projectId: body.projectId,
    expectedOrigin: body.expectedOrigin,
  });
  return c.json(result, result.status === 'OK' ? 200 : 400);
});

authCoreProjectRouter.get('/v1/auth-core/passkeys/:userId', async (c) => {
  return c.json(await listPasskeys(c.req.param('userId')));
});

authCoreProjectRouter.delete(
  '/v1/auth-core/passkeys/:userId/:credentialId',
  async (c) => {
    return c.json(
      await deletePasskey(c.req.param('userId'), c.req.param('credentialId')),
    );
  },
);

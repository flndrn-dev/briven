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
  setBrivenEngineBranding,
  setBrivenEngineMethodFlags,
  setBrivenEngineProviderSecrets,
  setBrivenEngineSmsSecrets,
  type BrivenEngineBranding,
  type BrivenEngineMethodFlags,
} from '../services/auth-core/project-config.js';
import { sendBrivenEngineSmsTest } from '../services/auth-core/delivery.js';
import { listBrivenEngineAudit } from '../services/auth-core/audit.js';
import { recordBrivenEngineAudit } from '../services/auth-core/audit.js';
import { env } from '../env.js';
import { ValidationError } from '@briven/shared';
import {
  brandingLogoPublicUrl,
  deleteBrandingLogo,
  isStorageConfigured,
  putBrandingLogo,
  validateLogoUpload,
} from '../services/auth-branding-logo.js';
import { updateAuthConfig } from '../services/tenant-config-store.js';
import { invalidateAuthInstance } from '../services/auth-tenant-pool.js';
import { log } from '../lib/logger.js';
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
      void recordBrivenEngineAudit({
        action: 'config.oauth_secrets.saved',
        projectId,
        // Never log secret values — provider id only.
        metadata: { thirdPartyId },
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
      void recordBrivenEngineAudit({
        action: 'config.methods.updated',
        projectId,
        metadata: { methods: result.methods },
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
    const accountSid = body.accountSid?.trim() ?? '';
    const authToken = body.authToken?.trim() ?? '';
    const fromNumber = body.fromNumber?.trim() ?? '';
    if (!accountSid || !authToken || !fromNumber) {
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'bad_request',
          message: 'accountSid, authToken, fromNumber required',
        },
        400,
      );
    }
    if (!fromNumber.startsWith('+')) {
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'bad_request',
          message:
            'fromNumber must be E.164 (start with + and country code), e.g. +15551234567',
        },
        400,
      );
    }
    try {
      const result = await setBrivenEngineSmsSecrets(projectId, {
        accountSid,
        authToken,
        fromNumber,
      });
      void recordBrivenEngineAudit({
        action: 'config.sms_secrets.saved',
        projectId,
        metadata: { fromNumber },
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

/** Save login email / hosted UI branding for this project. */
authCoreProjectRouter.put(
  '/v1/auth-core/projects/:projectId/branding',
  async (c) => {
    const projectId = c.req.param('projectId');
    let body: Partial<BrivenEngineBranding> = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    try {
      // Logo is managed only by POST/DELETE …/branding/logo — ignore logoUrl
      // on this PUT so a partial form save never wipes an uploaded logo.
      const { logoUrl: _ignoreLogo, ...rest } = body;
      const result = await setBrivenEngineBranding(projectId, rest);
      void recordBrivenEngineAudit({
        action: 'config.branding.saved',
        projectId,
        metadata: {
          hasLogo: Boolean(result.branding.logoUrl),
          primaryColor: result.branding.primaryColor,
          senderName: result.branding.senderName,
        },
      });
      const config = await getBrivenEngineProjectConfig(projectId);
      return c.json({
        ...result,
        branding: result.branding,
        config,
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

/**
 * Upload project logo (multipart field `file`). Dashboard session path —
 * same auth as other auth-core project routes so CSRF/cookies work via the
 * web proxy (the bare /v1/projects/…/logo rewrite often fails CSRF).
 */
authCoreProjectRouter.post(
  '/v1/auth-core/projects/:projectId/branding/logo',
  async (c) => {
    const projectId = c.req.param('projectId');
    if (!isStorageConfigured()) {
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'storage_not_configured',
          message: 'file storage is not configured on this api',
        },
        503,
      );
    }

    let file: File | null = null;
    try {
      const body = await c.req.parseBody();
      const f = body.file;
      if (f instanceof File) file = f;
    } catch {
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'validation_failed',
          message: 'expected multipart form-data with field `file`',
        },
        400,
      );
    }
    if (!file) {
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'validation_failed',
          message: 'missing `file` form field',
        },
        400,
      );
    }

    try {
      let contentType = file.type || '';
      if (!contentType && file.name) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.png')) contentType = 'image/png';
        else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg'))
          contentType = 'image/jpeg';
        else if (lower.endsWith('.webp')) contentType = 'image/webp';
        else if (lower.endsWith('.svg')) contentType = 'image/svg+xml';
      }
      validateLogoUpload({ contentType, size: file.size });
      const bytes = new Uint8Array(await file.arrayBuffer());
      await putBrandingLogo({ projectId, bytes, contentType });
      const logoUrl = brandingLogoPublicUrl(projectId);
      await setBrivenEngineBranding(projectId, { logoUrl });
      try {
        await updateAuthConfig(projectId, { branding: { logoUrl } });
        await invalidateAuthInstance(projectId);
      } catch {
        // Engine branding is source of truth for Auth dashboard.
      }
      void recordBrivenEngineAudit({
        action: 'config.branding.logo.uploaded',
        projectId,
        metadata: { contentType, sizeBytes: file.size },
      });
      const branding = (await getBrivenEngineProjectConfig(projectId)).branding;
      return c.json({
        ok: true,
        engine: BRIVEN_ENGINE_ID,
        logoUrl,
        branding,
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json(
          {
            engine: BRIVEN_ENGINE_ID,
            code: 'validation_failed',
            message: err.message,
          },
          400,
        );
      }
      log.error('briven_engine_branding_logo_upload_failed', {
        projectId,
        message: err instanceof Error ? err.message : String(err),
      });
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'logo_upload_failed',
          message: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }
  },
);

/** Remove project logo. */
authCoreProjectRouter.delete(
  '/v1/auth-core/projects/:projectId/branding/logo',
  async (c) => {
    const projectId = c.req.param('projectId');
    if (!isStorageConfigured()) {
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'storage_not_configured',
          message: 'file storage is not configured on this api',
        },
        503,
      );
    }
    try {
      await deleteBrandingLogo(projectId);
      await setBrivenEngineBranding(projectId, { logoUrl: null });
      try {
        await updateAuthConfig(projectId, { branding: { logoUrl: null } });
        await invalidateAuthInstance(projectId);
      } catch {
        /* engine branding is enough */
      }
      void recordBrivenEngineAudit({
        action: 'config.branding.logo.removed',
        projectId,
        metadata: {},
      });
      return c.json({
        ok: true,
        engine: BRIVEN_ENGINE_ID,
        logoUrl: null,
      });
    } catch (err) {
      log.error('briven_engine_branding_logo_remove_failed', {
        projectId,
        message: err instanceof Error ? err.message : String(err),
      });
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'logo_remove_failed',
          message: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }
  },
);

/** Security audit trail for this project (newest first). */
authCoreProjectRouter.get(
  '/v1/auth-core/projects/:projectId/audit',
  async (c) => {
    const projectId = c.req.param('projectId');
    const limit = Number(c.req.query('limit') ?? '50');
    const action = c.req.query('action') ?? null;
    const userId = c.req.query('userId') ?? null;
    try {
      const result = await listBrivenEngineAudit({
        projectId,
        limit: Number.isFinite(limit) ? limit : 50,
        action,
        userId,
      });
      return c.json(result);
    } catch (err) {
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'audit_list_failed',
          message: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }
  },
);

/** Send a test SMS with saved project secrets (no login code). */
authCoreProjectRouter.post(
  '/v1/auth-core/projects/:projectId/delivery/sms/test',
  async (c) => {
    const projectId = c.req.param('projectId');
    let body: { phoneNumber?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const phoneNumber = body.phoneNumber?.trim() ?? '';
    if (!phoneNumber) {
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'bad_request',
          message: 'phoneNumber required (E.164, e.g. +15551234567)',
        },
        400,
      );
    }
    try {
      const config = await getBrivenEngineProjectConfig(projectId);
      if (!config.delivery.sms.configured) {
        return c.json(
          {
            engine: BRIVEN_ENGINE_ID,
            code: 'sms_not_configured',
            ok: false,
            message:
              'SMS not set — save Account SID, Auth token, and From number first',
            delivery: config.delivery.sms,
            methods: config.methods,
          },
          400,
        );
      }
      const result = await sendBrivenEngineSmsTest({ projectId, phoneNumber });
      const status = result.ok ? 200 : result.mode === 'log' ? 400 : 502;
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          ok: result.ok,
          delivery: result,
          methods: config.methods,
          passwordlessSmsEnabled: config.methods.passwordlessSms,
          hint: result.ok
            ? config.methods.passwordlessSms
              ? 'Test sent. passwordless-sms is on for this project.'
              : 'Test sent. Turn on passwordless-sms under Providers so apps can use phone login.'
            : undefined,
        },
        status,
      );
    } catch (err) {
      return c.json(
        {
          engine: BRIVEN_ENGINE_ID,
          code: 'sms_test_failed',
          ok: false,
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

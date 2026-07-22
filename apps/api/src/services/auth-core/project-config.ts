/**
 * briven-engine per-project config (Path A).
 *
 * Stores social client secrets + SMS/email provider secrets via tenant_secrets
 * (service = 'auth'). Recipe feature flags live in memory/env until a dedicated
 * config row is migrated (local build — no deploy).
 *
 * Product brand: briven-engine only.
 */

import {
  getTenantSecret,
  hasTenantSecret,
  setTenantSecret,
} from '../tenant-secrets.js';
import {
  BRIVEN_ENGINE_SOCIAL_CATALOG,
  type BrivenSocialProviderId,
  type ProjectProviderSecrets,
} from './providers.js';
import { mapProjectToAuthCore } from './project-map.js';

const SERVICE = 'auth' as const;

function clientIdName(id: BrivenSocialProviderId): string {
  return `briven_engine_${id}_client_id`;
}
function clientSecretName(id: BrivenSocialProviderId): string {
  return `briven_engine_${id}_client_secret`;
}
function extraName(id: BrivenSocialProviderId, key: string): string {
  return `briven_engine_${id}_${key}`;
}

export type BrivenEngineProjectConfig = {
  engine: 'briven-engine';
  projectId: string;
  appId: string;
  tenantId: string;
  providers: Array<{
    thirdPartyId: BrivenSocialProviderId;
    name: string;
    configured: boolean;
    hasClientId: boolean;
    hasClientSecret: boolean;
  }>;
  delivery: {
    sms: { configured: boolean; provider: string | null };
    email: { configured: boolean; provider: string | null };
  };
  recipes: {
    emailPassword: boolean;
    passwordless: boolean;
    passwordlessSms: boolean;
    thirdParty: boolean;
    webauthn: boolean;
    mfa: boolean;
  };
};

/**
 * Public config view (no secret values).
 */
export async function getBrivenEngineProjectConfig(
  projectId: string,
): Promise<BrivenEngineProjectConfig> {
  const map = mapProjectToAuthCore(projectId);

  const providers = await Promise.all(
    BRIVEN_ENGINE_SOCIAL_CATALOG.map(async (p) => {
      const hasClientId = await hasTenantSecret(
        projectId,
        SERVICE,
        clientIdName(p.thirdPartyId),
      );
      const hasClientSecret = await hasTenantSecret(
        projectId,
        SERVICE,
        clientSecretName(p.thirdPartyId),
      );
      return {
        thirdPartyId: p.thirdPartyId,
        name: p.name,
        configured: hasClientId && hasClientSecret,
        hasClientId,
        hasClientSecret,
      };
    }),
  );

  const smsSid = await hasTenantSecret(projectId, SERVICE, 'briven_engine_sms_account_sid');
  const smsToken = await hasTenantSecret(projectId, SERVICE, 'briven_engine_sms_auth_token');
  const emailHost = await hasTenantSecret(projectId, SERVICE, 'briven_engine_smtp_host');

  return {
    engine: 'briven-engine',
    projectId,
    appId: map.appId,
    tenantId: map.tenantId,
    providers,
    delivery: {
      sms: {
        configured: smsSid && smsToken,
        provider: smsSid && smsToken ? 'twilio-compatible' : null,
      },
      email: {
        configured: emailHost,
        provider: emailHost ? 'smtp' : null,
      },
    },
    recipes: {
      emailPassword: true,
      passwordless: true,
      passwordlessSms: true,
      thirdParty: true,
      webauthn: true,
      mfa: true,
    },
  };
}

/**
 * Save social provider credentials for a project (encrypted at rest).
 */
export async function setBrivenEngineProviderSecrets(
  projectId: string,
  input: {
    thirdPartyId: BrivenSocialProviderId;
    clientId: string;
    clientSecret: string;
    additionalConfig?: Record<string, string>;
    createdBy?: string;
  },
): Promise<{ ok: true; engine: 'briven-engine' }> {
  await setTenantSecret(
    projectId,
    SERVICE,
    clientIdName(input.thirdPartyId),
    input.clientId,
    input.createdBy ?? null,
  );
  await setTenantSecret(
    projectId,
    SERVICE,
    clientSecretName(input.thirdPartyId),
    input.clientSecret,
    input.createdBy ?? null,
  );
  if (input.additionalConfig) {
    for (const [k, v] of Object.entries(input.additionalConfig)) {
      if (!v) continue;
      await setTenantSecret(
        projectId,
        SERVICE,
        extraName(input.thirdPartyId, k),
        v,
        input.createdBy ?? null,
      );
    }
  }
  return { ok: true, engine: 'briven-engine' };
}

/**
 * Load decrypted provider secrets for recipe wiring (server-side only).
 */
export async function loadProjectProviderSecrets(
  projectId: string,
): Promise<ProjectProviderSecrets[]> {
  const out: ProjectProviderSecrets[] = [];
  for (const p of BRIVEN_ENGINE_SOCIAL_CATALOG) {
    const clientId = await getTenantSecret(
      projectId,
      SERVICE,
      clientIdName(p.thirdPartyId),
    );
    const clientSecret = await getTenantSecret(
      projectId,
      SERVICE,
      clientSecretName(p.thirdPartyId),
    );
    if (!clientId || !clientSecret) continue;
    const additionalConfig: Record<string, string> = {};
    if (p.thirdPartyId === 'apple') {
      const keyId = await getTenantSecret(
        projectId,
        SERVICE,
        extraName('apple', 'keyId'),
      );
      const teamId = await getTenantSecret(
        projectId,
        SERVICE,
        extraName('apple', 'teamId'),
      );
      if (keyId) additionalConfig.keyId = keyId;
      if (teamId) additionalConfig.teamId = teamId;
    }
    out.push({
      thirdPartyId: p.thirdPartyId,
      clientId,
      clientSecret,
      additionalConfig:
        Object.keys(additionalConfig).length > 0 ? additionalConfig : undefined,
    });
  }
  return out;
}

/**
 * SMS provider secrets (Twilio-compatible shape).
 */
export async function setBrivenEngineSmsSecrets(
  projectId: string,
  input: {
    accountSid: string;
    authToken: string;
    fromNumber: string;
    createdBy?: string;
  },
): Promise<{ ok: true; engine: 'briven-engine' }> {
  await setTenantSecret(
    projectId,
    SERVICE,
    'briven_engine_sms_account_sid',
    input.accountSid,
    input.createdBy ?? null,
  );
  await setTenantSecret(
    projectId,
    SERVICE,
    'briven_engine_sms_auth_token',
    input.authToken,
    input.createdBy ?? null,
  );
  await setTenantSecret(
    projectId,
    SERVICE,
    'briven_engine_sms_from',
    input.fromNumber,
    input.createdBy ?? null,
  );
  return { ok: true, engine: 'briven-engine' };
}

export async function getBrivenEngineSmsSecrets(projectId: string): Promise<{
  accountSid: string;
  authToken: string;
  fromNumber: string;
} | null> {
  const accountSid = await getTenantSecret(
    projectId,
    SERVICE,
    'briven_engine_sms_account_sid',
  );
  const authToken = await getTenantSecret(
    projectId,
    SERVICE,
    'briven_engine_sms_auth_token',
  );
  const fromNumber = await getTenantSecret(
    projectId,
    SERVICE,
    'briven_engine_sms_from',
  );
  if (!accountSid || !authToken || !fromNumber) return null;
  return { accountSid, authToken, fromNumber };
}

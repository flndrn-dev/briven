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
/** Legacy names from pre-engine Auth product (still on some projects). */
function legacyClientIdName(id: BrivenSocialProviderId): string {
  return `${id}_client_id`;
}
function legacyClientSecretName(id: BrivenSocialProviderId): string {
  return `${id}_client_secret`;
}
function extraName(id: BrivenSocialProviderId, key: string): string {
  return `briven_engine_${id}_${key}`;
}

async function hasProviderClientId(
  projectId: string,
  id: BrivenSocialProviderId,
): Promise<boolean> {
  if (await hasTenantSecret(projectId, SERVICE, clientIdName(id))) return true;
  return hasTenantSecret(projectId, SERVICE, legacyClientIdName(id));
}

async function hasProviderClientSecret(
  projectId: string,
  id: BrivenSocialProviderId,
): Promise<boolean> {
  if (await hasTenantSecret(projectId, SERVICE, clientSecretName(id))) {
    return true;
  }
  return hasTenantSecret(projectId, SERVICE, legacyClientSecretName(id));
}

async function readProviderClientId(
  projectId: string,
  id: BrivenSocialProviderId,
): Promise<string | null> {
  return (
    (await getTenantSecret(projectId, SERVICE, clientIdName(id))) ??
    (await getTenantSecret(projectId, SERVICE, legacyClientIdName(id)))
  );
}

async function readProviderClientSecret(
  projectId: string,
  id: BrivenSocialProviderId,
): Promise<string | null> {
  return (
    (await getTenantSecret(projectId, SERVICE, clientSecretName(id))) ??
    (await getTenantSecret(projectId, SERVICE, legacyClientSecretName(id)))
  );
}

/** Per-project which sign-in methods are turned on for the app. */
export type BrivenEngineMethodFlags = {
  emailPassword: boolean;
  /** Email OTP codes */
  passwordlessEmail: boolean;
  /** Magic link in email */
  magicLink: boolean;
  passwordlessSms: boolean;
  passkeys: boolean;
  mfa: boolean;
};

const DEFAULT_METHOD_FLAGS: BrivenEngineMethodFlags = {
  emailPassword: true,
  passwordlessEmail: true,
  magicLink: true,
  passwordlessSms: false,
  passkeys: true,
  mfa: false,
};

const METHOD_FLAGS_SECRET = 'briven_engine_method_flags';
const BRANDING_SECRET = 'briven_engine_branding';

/** Login email / hosted UI look for one project. */
export type BrivenEngineBranding = {
  logoUrl: string | null;
  primaryColor: string;
  senderName: string;
};

export const DEFAULT_BRIVEN_ENGINE_BRANDING: BrivenEngineBranding = {
  logoUrl: null,
  primaryColor: '#FFFD74',
  senderName: 'Briven Auth',
};

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
    help?: string;
    callbackHint?: string;
  }>;
  delivery: {
    sms: { configured: boolean; provider: string | null };
    email: { configured: boolean; provider: string | null };
  };
  branding: BrivenEngineBranding;
  /** Legacy boolean bag (kept for older UI). */
  recipes: {
    emailPassword: boolean;
    passwordless: boolean;
    passwordlessSms: boolean;
    thirdParty: boolean;
    webauthn: boolean;
    mfa: boolean;
  };
  /** Which methods this project wants on (operator choice). */
  methods: BrivenEngineMethodFlags;
  /** Flat list for chips / overview. */
  methodChips: Array<{
    id: string;
    label: string;
    kind: 'core' | 'oauth';
    enabled: boolean;
    configured: boolean;
    hrefSuffix: string;
  }>;
};

export async function getBrivenEngineBranding(
  projectId: string,
): Promise<BrivenEngineBranding> {
  try {
    const raw = await getTenantSecret(projectId, SERVICE, BRANDING_SECRET);
    if (!raw) return { ...DEFAULT_BRIVEN_ENGINE_BRANDING };
    const parsed = JSON.parse(raw) as Partial<BrivenEngineBranding>;
    return normalizeBranding(parsed);
  } catch {
    return { ...DEFAULT_BRIVEN_ENGINE_BRANDING };
  }
}

function normalizeBranding(
  input: Partial<BrivenEngineBranding> | null | undefined,
): BrivenEngineBranding {
  const color =
    typeof input?.primaryColor === 'string' &&
    /^#[0-9A-Fa-f]{6}$/.test(input.primaryColor.trim())
      ? input.primaryColor.trim()
      : DEFAULT_BRIVEN_ENGINE_BRANDING.primaryColor;
  const name =
    typeof input?.senderName === 'string' && input.senderName.trim()
      ? input.senderName.trim().slice(0, 80)
      : DEFAULT_BRIVEN_ENGINE_BRANDING.senderName;
  let logoUrl: string | null = null;
  if (typeof input?.logoUrl === 'string' && input.logoUrl.trim()) {
    const u = input.logoUrl.trim();
    if (u.startsWith('https://') || u.startsWith('http://localhost')) {
      logoUrl = u.slice(0, 500);
    }
  }
  return { logoUrl, primaryColor: color, senderName: name };
}

export async function setBrivenEngineBranding(
  projectId: string,
  input: Partial<BrivenEngineBranding>,
  createdBy?: string | null,
): Promise<{ ok: true; engine: 'briven-engine'; branding: BrivenEngineBranding }> {
  const current = await getBrivenEngineBranding(projectId);
  const next = normalizeBranding({
    logoUrl:
      input.logoUrl === undefined
        ? current.logoUrl
        : input.logoUrl === null || input.logoUrl === ''
          ? null
          : input.logoUrl,
    primaryColor: input.primaryColor ?? current.primaryColor,
    senderName: input.senderName ?? current.senderName,
  });
  await setTenantSecret(
    projectId,
    SERVICE,
    BRANDING_SECRET,
    JSON.stringify(next),
    createdBy ?? null,
  );
  return { ok: true, engine: 'briven-engine', branding: next };
}

async function loadMethodFlags(
  projectId: string,
): Promise<BrivenEngineMethodFlags> {
  try {
    const raw = await getTenantSecret(projectId, SERVICE, METHOD_FLAGS_SECRET);
    if (!raw) return { ...DEFAULT_METHOD_FLAGS };
    const parsed = JSON.parse(raw) as Partial<BrivenEngineMethodFlags>;
    return {
      emailPassword: parsed.emailPassword ?? DEFAULT_METHOD_FLAGS.emailPassword,
      passwordlessEmail:
        parsed.passwordlessEmail ?? DEFAULT_METHOD_FLAGS.passwordlessEmail,
      magicLink: parsed.magicLink ?? DEFAULT_METHOD_FLAGS.magicLink,
      passwordlessSms:
        parsed.passwordlessSms ?? DEFAULT_METHOD_FLAGS.passwordlessSms,
      passkeys: parsed.passkeys ?? DEFAULT_METHOD_FLAGS.passkeys,
      mfa: parsed.mfa ?? DEFAULT_METHOD_FLAGS.mfa,
    };
  } catch {
    return { ...DEFAULT_METHOD_FLAGS };
  }
}

/**
 * Public config view (no secret values).
 */
export async function getBrivenEngineProjectConfig(
  projectId: string,
): Promise<BrivenEngineProjectConfig> {
  const map = mapProjectToAuthCore(projectId);
  const methods = await loadMethodFlags(projectId);
  const branding = await getBrivenEngineBranding(projectId);

  const providers = await Promise.all(
    BRIVEN_ENGINE_SOCIAL_CATALOG.map(async (p) => {
      const hasClientId = await hasProviderClientId(
        projectId,
        p.thirdPartyId,
      );
      const hasClientSecret = await hasProviderClientSecret(
        projectId,
        p.thirdPartyId,
      );
      return {
        thirdPartyId: p.thirdPartyId,
        name: p.name,
        configured: hasClientId && hasClientSecret,
        hasClientId,
        hasClientSecret,
        help: p.help,
        callbackHint: p.callbackHint,
      };
    }),
  );

  const smsSid = await hasTenantSecret(projectId, SERVICE, 'briven_engine_sms_account_sid');
  const smsToken = await hasTenantSecret(projectId, SERVICE, 'briven_engine_sms_auth_token');
  const smsFrom = await hasTenantSecret(projectId, SERVICE, 'briven_engine_sms_from');
  /** Ready only when Twilio-compatible triple is present (SID + token + from). */
  const smsConfigured = smsSid && smsToken && smsFrom;
  const emailHost = await hasTenantSecret(projectId, SERVICE, 'briven_engine_smtp_host');

  const anyOauthConfigured = providers.some((p) => p.configured);

  const methodChips: BrivenEngineProjectConfig['methodChips'] = [
    {
      id: 'emailPassword',
      label: 'email + password',
      kind: 'core',
      enabled: methods.emailPassword,
      configured: true,
      hrefSuffix: 'providers?method=emailPassword',
    },
    {
      id: 'passwordless-email',
      label: 'passwordless-email',
      kind: 'core',
      enabled: methods.passwordlessEmail,
      configured: true,
      hrefSuffix: 'providers?method=passwordlessEmail',
    },
    {
      id: 'magic-link',
      label: 'magic-link',
      kind: 'core',
      enabled: methods.magicLink,
      configured: true,
      hrefSuffix: 'providers?method=magicLink',
    },
    {
      id: 'passwordless-sms',
      label: 'passwordless-sms',
      kind: 'core',
      enabled: methods.passwordlessSms,
      configured: smsConfigured,
      hrefSuffix: 'providers?method=passwordlessSms',
    },
    {
      id: 'passkeys',
      label: 'passkeys',
      kind: 'core',
      enabled: methods.passkeys,
      configured: true,
      hrefSuffix: 'providers?method=passkeys',
    },
    {
      id: 'mfa',
      label: 'mfa (TOTP)',
      kind: 'core',
      enabled: methods.mfa,
      configured: true,
      hrefSuffix: 'security',
    },
    ...providers.map((p) => ({
      id: p.thirdPartyId,
      label: p.name,
      kind: 'oauth' as const,
      enabled: p.configured,
      configured: p.configured,
      hrefSuffix: `providers?provider=${p.thirdPartyId}`,
    })),
  ];

  return {
    engine: 'briven-engine',
    projectId,
    appId: map.appId,
    tenantId: map.tenantId,
    providers,
    delivery: {
      sms: {
        configured: smsConfigured,
        provider: smsConfigured ? 'twilio-compatible' : null,
      },
      email: {
        configured: emailHost,
        provider: emailHost ? 'smtp' : null,
      },
    },
    branding,
    methods,
    methodChips,
    recipes: {
      emailPassword: methods.emailPassword,
      passwordless: methods.passwordlessEmail || methods.magicLink,
      passwordlessSms: methods.passwordlessSms,
      thirdParty: anyOauthConfigured,
      webauthn: methods.passkeys,
      mfa: methods.mfa,
    },
  };
}

/**
 * Save which sign-in methods this project wants on.
 */
export async function setBrivenEngineMethodFlags(
  projectId: string,
  flags: Partial<BrivenEngineMethodFlags>,
  createdBy?: string | null,
): Promise<{ ok: true; engine: 'briven-engine'; methods: BrivenEngineMethodFlags }> {
  const current = await loadMethodFlags(projectId);
  const next: BrivenEngineMethodFlags = {
    emailPassword: flags.emailPassword ?? current.emailPassword,
    passwordlessEmail: flags.passwordlessEmail ?? current.passwordlessEmail,
    magicLink: flags.magicLink ?? current.magicLink,
    passwordlessSms: flags.passwordlessSms ?? current.passwordlessSms,
    passkeys: flags.passkeys ?? current.passkeys,
    mfa: flags.mfa ?? current.mfa,
  };
  await setTenantSecret(
    projectId,
    SERVICE,
    METHOD_FLAGS_SECRET,
    JSON.stringify(next),
    createdBy ?? null,
  );
  return { ok: true, engine: 'briven-engine', methods: next };
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
    const clientId = await readProviderClientId(projectId, p.thirdPartyId);
    const clientSecret = await readProviderClientSecret(
      projectId,
      p.thirdPartyId,
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

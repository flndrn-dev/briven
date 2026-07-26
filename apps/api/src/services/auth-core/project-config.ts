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
/** App origins allowed for CORS / passkey rpId / magic-link return (JSON string[]). */
const APP_ORIGINS_SECRET = 'briven_engine_app_origins';
/** Custom OIDC ID-token claims (JSON object of string keys → string|number|boolean). */
const JWT_CLAIMS_SECRET = 'briven_engine_jwt_claims';
/** When true, email/password sign-in also accepts metadata.username. */
const USERNAME_LOGIN_SECRET = 'briven_engine_username_login';

/** Login email / hosted UI look for one project. */
export type BrivenEngineBranding = {
  logoUrl: string | null;
  primaryColor: string;
  senderName: string;
  /**
   * Public brand site shown in the email footer as `{name} · {brandUrl}`.
   * e.g. `https://mavi.app` or `briven.tech`. Null = show name only.
   */
  brandUrl: string | null;
  /** Optional short line under the email body (support / legal). */
  footerNote: string | null;
  /**
   * Custom email footer (3 optional lines). Operators pick text + which
   * lines to show — no hard-coded Flanders/flndrn copy.
   *
   * Line 1: made with ♥ {footerLoveName} by {footerOrgName}
   * Line 2: {footerTagline}
   * Line 3: {footerOrgName}, {footerCity}, {footerCountry}
   */
  footerLoveName: string | null;
  footerOrgName: string | null;
  footerTagline: string | null;
  footerCity: string | null;
  footerCountry: string | null;
  footerShowLove: boolean;
  footerShowTagline: boolean;
  footerShowAddress: boolean;
};

export const DEFAULT_BRIVEN_ENGINE_BRANDING: BrivenEngineBranding = {
  logoUrl: null,
  primaryColor: '#FFFD74',
  senderName: 'Briven Auth',
  brandUrl: null,
  footerNote: null,
  footerLoveName: null,
  footerOrgName: null,
  footerTagline: null,
  footerCity: null,
  footerCountry: null,
  footerShowLove: false,
  footerShowTagline: false,
  footerShowAddress: false,
};

/** Plain footer lines for email HTML/text (empty strings filtered out). */
export function buildAuthEmailFooterLines(
  b: BrivenEngineBranding,
): string[] {
  const lines: string[] = [];
  const org = (b.footerOrgName ?? '').trim();
  const love = (b.footerLoveName ?? '').trim();
  const tag = (b.footerTagline ?? '').trim();
  const city = (b.footerCity ?? '').trim();
  const country = (b.footerCountry ?? '').trim();

  if (b.footerShowLove) {
    // "made with ♥ {name} by {organization}"
    if (love && org) lines.push(`made with ♥ ${love} by ${org}`);
    else if (love) lines.push(`made with ♥ ${love}`);
    else if (org) lines.push(`made with ♥ by ${org}`);
  }
  if (b.footerShowTagline && tag) {
    lines.push(tag);
  }
  if (b.footerShowAddress) {
    const parts = [org, city, country].filter(Boolean);
    if (parts.length) lines.push(parts.join(', '));
  }
  return lines;
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
  /**
   * App website origins for this project (e.g. http://localhost:3000,
   * https://pay.example.com). Used by golden-path setup + CORS/passkey.
   */
  appOrigins: string[];
  /** Extra claims merged into OIDC ID tokens (string keys only). */
  jwtClaims: Record<string, string | number | boolean>;
  /** Allow sign-in with username (stored in user metadata) as well as email. */
  usernameLogin: boolean;
  /**
   * Bot protection for app login (Turnstile). When required=true, FDI expects
   * turnstileToken on sign-up / sign-in. siteKey is public for the widget.
   */
  captcha: {
    required: boolean;
    siteKey: string | null;
    provider: 'turnstile' | null;
  };
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
  // Logo is upload-only. The only valid logoUrl is our public CDN route
  // (…/auth/branding/logo). Free-form external URLs are rejected.
  let logoUrl: string | null = null;
  if (typeof input?.logoUrl === 'string' && input.logoUrl.trim()) {
    const u = input.logoUrl.trim().slice(0, 500);
    if (
      (u.startsWith('https://') || u.startsWith('http://localhost')) &&
      /\/v1\/projects\/[^/]+\/auth\/branding\/logo(?:\?|$)/.test(u)
    ) {
      logoUrl = u;
    }
  }
  let brandUrl: string | null = null;
  if (typeof input?.brandUrl === 'string' && input.brandUrl.trim()) {
    const raw = input.brandUrl.trim().slice(0, 200);
    // Accept bare domains (briven.tech) or full https URLs.
    if (/^https?:\/\//i.test(raw)) {
      try {
        const u = new URL(raw);
        if (u.protocol === 'https:' || (u.protocol === 'http:' && u.hostname === 'localhost')) {
          brandUrl = u.toString().replace(/\/$/, '');
        }
      } catch {
        brandUrl = null;
      }
    } else if (/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[\w./-]*)?$/i.test(raw)) {
      brandUrl = raw.replace(/\/$/, '');
    }
  }
  let footerNote: string | null = null;
  if (typeof input?.footerNote === 'string' && input.footerNote.trim()) {
    footerNote = input.footerNote.trim().slice(0, 200);
  }

  const strOrNull = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string' || !v.trim()) return null;
    return v.trim().slice(0, max);
  };
  const boolOr = (v: unknown, fallback: boolean): boolean =>
    typeof v === 'boolean' ? v : fallback;

  return {
    logoUrl,
    primaryColor: color,
    senderName: name,
    brandUrl,
    footerNote,
    footerLoveName: strOrNull(input?.footerLoveName, 80),
    footerOrgName: strOrNull(input?.footerOrgName, 120),
    footerTagline: strOrNull(input?.footerTagline, 200),
    footerCity: strOrNull(input?.footerCity, 80),
    footerCountry: strOrNull(input?.footerCountry, 80),
    footerShowLove: boolOr(
      input?.footerShowLove,
      DEFAULT_BRIVEN_ENGINE_BRANDING.footerShowLove,
    ),
    footerShowTagline: boolOr(
      input?.footerShowTagline,
      DEFAULT_BRIVEN_ENGINE_BRANDING.footerShowTagline,
    ),
    footerShowAddress: boolOr(
      input?.footerShowAddress,
      DEFAULT_BRIVEN_ENGINE_BRANDING.footerShowAddress,
    ),
  };
}

export async function setBrivenEngineBranding(
  projectId: string,
  input: Partial<BrivenEngineBranding>,
  createdBy?: string | null,
): Promise<{ ok: true; engine: 'briven-engine'; branding: BrivenEngineBranding }> {
  const current = await getBrivenEngineBranding(projectId);
  const pickStr = (
    next: string | null | undefined,
    cur: string | null,
  ): string | null => {
    if (next === undefined) return cur;
    if (next === null || next === '') return null;
    return next;
  };
  const pickBool = (next: boolean | undefined, cur: boolean): boolean =>
    next === undefined ? cur : next;

  const next = normalizeBranding({
    logoUrl:
      input.logoUrl === undefined
        ? current.logoUrl
        : input.logoUrl === null || input.logoUrl === ''
          ? null
          : input.logoUrl,
    primaryColor: input.primaryColor ?? current.primaryColor,
    senderName: input.senderName ?? current.senderName,
    brandUrl:
      input.brandUrl === undefined
        ? current.brandUrl
        : input.brandUrl === null || input.brandUrl === ''
          ? null
          : input.brandUrl,
    footerNote:
      input.footerNote === undefined
        ? current.footerNote
        : input.footerNote === null || input.footerNote === ''
          ? null
          : input.footerNote,
    footerLoveName: pickStr(input.footerLoveName, current.footerLoveName),
    footerOrgName: pickStr(input.footerOrgName, current.footerOrgName),
    footerTagline: pickStr(input.footerTagline, current.footerTagline),
    footerCity: pickStr(input.footerCity, current.footerCity),
    footerCountry: pickStr(input.footerCountry, current.footerCountry),
    footerShowLove: pickBool(input.footerShowLove, current.footerShowLove),
    footerShowTagline: pickBool(
      input.footerShowTagline,
      current.footerShowTagline,
    ),
    footerShowAddress: pickBool(
      input.footerShowAddress,
      current.footerShowAddress,
    ),
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

function normalizeOrigin(raw: string): string | null {
  const t = raw.trim().replace(/\/$/, '');
  if (!t) return null;
  try {
    const u = new URL(t.includes('://') ? t : `https://${t}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.protocol === 'http:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
      return null;
    }
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export async function getBrivenEngineAppOrigins(
  projectId: string,
): Promise<string[]> {
  try {
    const raw = await getTenantSecret(projectId, SERVICE, APP_ORIGINS_SECRET);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item !== 'string') continue;
      const o = normalizeOrigin(item);
      if (o && !out.includes(o)) out.push(o);
    }
    return out;
  } catch {
    return [];
  }
}

export async function setBrivenEngineAppOrigins(
  projectId: string,
  origins: string[],
  createdBy?: string | null,
): Promise<{ ok: true; engine: 'briven-engine'; appOrigins: string[] }> {
  const next: string[] = [];
  for (const item of origins) {
    const o = normalizeOrigin(item);
    if (o && !next.includes(o)) next.push(o);
  }
  await setTenantSecret(
    projectId,
    SERVICE,
    APP_ORIGINS_SECRET,
    JSON.stringify(next),
    createdBy ?? null,
  );
  return { ok: true, engine: 'briven-engine', appOrigins: next };
}

/** Append origins without removing existing ones. */
export async function addBrivenEngineAppOrigins(
  projectId: string,
  origins: string[],
  createdBy?: string | null,
): Promise<{ ok: true; engine: 'briven-engine'; appOrigins: string[] }> {
  const current = await getBrivenEngineAppOrigins(projectId);
  return setBrivenEngineAppOrigins(
    projectId,
    [...current, ...origins],
    createdBy,
  );
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

  const appOrigins = await getBrivenEngineAppOrigins(projectId);
  const jwtClaims = await getBrivenEngineJwtClaims(projectId);
  const usernameLogin = await getBrivenEngineUsernameLogin(projectId);

  // Platform Turnstile (not per-project secret store): apps read siteKey for widget.
  let captchaRequired = false;
  let captchaSiteKey: string | null = null;
  try {
    const { env } = await import('../../env.js');
    captchaRequired = Boolean(env.BRIVEN_TURNSTILE_SECRET_KEY);
    captchaSiteKey = env.BRIVEN_TURNSTILE_SITE_KEY ?? null;
  } catch {
    captchaRequired = false;
    captchaSiteKey = null;
  }

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
    appOrigins,
    jwtClaims,
    usernameLogin,
    captcha: {
      required: captchaRequired,
      siteKey: captchaSiteKey,
      provider: captchaRequired ? 'turnstile' : null,
    },
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

/** Custom claims for OIDC ID tokens (project-wide template). */
export async function getBrivenEngineJwtClaims(
  projectId: string,
): Promise<Record<string, string | number | boolean>> {
  try {
    const raw = await getTenantSecret(projectId, SERVICE, JWT_CLAIMS_SECRET);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/.test(k)) continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function setBrivenEngineJwtClaims(
  projectId: string,
  claims: Record<string, string | number | boolean>,
  createdBy?: string | null,
): Promise<{ ok: true; engine: 'briven-engine'; jwtClaims: Record<string, string | number | boolean> }> {
  const cleaned = await getBrivenEngineJwtClaims(projectId);
  // replace with validated input
  const next: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(claims ?? {})) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/.test(k)) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      next[k] = v;
    }
  }
  await setTenantSecret(
    projectId,
    SERVICE,
    JWT_CLAIMS_SECRET,
    JSON.stringify(next),
    createdBy ?? null,
  );
  void cleaned;
  return { ok: true, engine: 'briven-engine', jwtClaims: next };
}

export async function getBrivenEngineUsernameLogin(projectId: string): Promise<boolean> {
  try {
    const raw = await getTenantSecret(projectId, SERVICE, USERNAME_LOGIN_SECRET);
    return raw === 'true' || raw === '1';
  } catch {
    return false;
  }
}

export async function setBrivenEngineUsernameLogin(
  projectId: string,
  enabled: boolean,
  createdBy?: string | null,
): Promise<{ ok: true; engine: 'briven-engine'; usernameLogin: boolean }> {
  await setTenantSecret(
    projectId,
    SERVICE,
    USERNAME_LOGIN_SECRET,
    enabled ? 'true' : 'false',
    createdBy ?? null,
  );
  return { ok: true, engine: 'briven-engine', usernameLogin: enabled };
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

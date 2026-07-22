/**
 * Briven Auth v2 — workspace helpers (Phase 1 + Phase 8 security surface).
 *
 * SuperTokens-shaped product packaging on top of Briven multi-project Doltgres:
 * list every project the operator can manage, with Auth enabled flag + live
 * provider toggles (read-after-write proof for "save sticks").
 * Phase 8: 2FA / backup-code gate + password policy via the yellow Security page.
 */

import { listProjectsForUser } from './projects.js';
import {
  getAuthConfig,
  isAuthEnabled,
  updateAuthConfig,
  type AuthConfig,
} from './tenant-config-store.js';
import { invalidateAuthInstance } from './auth-tenant-pool.js';
import {
  getPasswordPolicy,
  setPasswordPolicy,
  type PasswordPolicy,
} from './auth-password-policy.js';

export interface AuthV2ProviderFlags {
  emailPassword: boolean;
  magicLink: boolean;
  emailOtp: boolean;
  passkey: boolean;
}

/** Phase 8.1 — tenant 2FA switch (backup codes ship with the twoFactor plugin). */
export interface AuthV2TwoFactorFlags {
  enabled: boolean;
  required: boolean;
  /** Always 10 when twoFactor is on — Better Auth backupCodeOptions.amount */
  backupCodeCount: number;
}

export interface AuthV2ProjectRow {
  id: string;
  slug: string;
  name: string;
  authEnabled: boolean;
  providers: AuthV2ProviderFlags | null;
  /** true if config read failed (DB not ready / auth tables missing) */
  error?: boolean;
}

/** Pure map — unit-tested; used after every save for read-back proof. */
export function flagsFromConfig(config: AuthConfig): AuthV2ProviderFlags {
  return {
    emailPassword: config.providers.emailPassword.enabled,
    magicLink: config.providers.magicLink.enabled,
    emailOtp: config.providers.emailOtp.enabled,
    passkey: config.providers.passkey.enabled,
  };
}

/** At least one core method must stay on (Phase 1 product rule). */
export function hasAtLeastOneProvider(flags: AuthV2ProviderFlags): boolean {
  return flags.emailPassword || flags.magicLink || flags.emailOtp || flags.passkey;
}

export function twoFactorFromConfig(config: AuthConfig): AuthV2TwoFactorFlags {
  return {
    enabled: config.twoFactor.enabled,
    required: config.twoFactor.required,
    // Better Auth twoFactor plugin: backupCodeOptions.amount = 10
    backupCodeCount: config.twoFactor.enabled ? 10 : 0,
  };
}

/**
 * Required cannot stay on if 2FA is off (would lock everyone out of enroll).
 */
export function normalizeTwoFactorFlags(input: {
  enabled: boolean;
  required: boolean;
}): AuthV2TwoFactorFlags {
  const enabled = input.enabled === true;
  const required = enabled && input.required === true;
  return {
    enabled,
    required,
    backupCodeCount: enabled ? 10 : 0,
  };
}

/**
 * All projects the user belongs to, with Auth enable + core provider flags.
 * Failures on a single project do not fail the whole workspace list.
 */
export async function listAuthV2Workspace(userId: string): Promise<{
  projects: AuthV2ProjectRow[];
}> {
  const projects = await listProjectsForUser(userId);
  const rows: AuthV2ProjectRow[] = await Promise.all(
    projects.map(async (p) => {
      const name = (p as { name?: string | null }).name?.trim() || p.slug;
      try {
        const enabled = await isAuthEnabled(p.id);
        if (!enabled) {
          return {
            id: p.id,
            slug: p.slug,
            name,
            authEnabled: false,
            providers: null,
          };
        }
        const config = await getAuthConfig(p.id);
        return {
          id: p.id,
          slug: p.slug,
          name,
          authEnabled: true,
          providers: flagsFromConfig(config),
        };
      } catch {
        return {
          id: p.id,
          slug: p.slug,
          name,
          authEnabled: false,
          providers: null,
          error: true,
        };
      }
    }),
  );
  return { projects: rows };
}

/**
 * Save core passwordless + password toggles, invalidate live instance,
 * re-read config so the UI can prove the save stuck.
 */
export async function saveAuthV2Providers(
  projectId: string,
  flags: AuthV2ProviderFlags,
): Promise<{ enabled: boolean; providers: AuthV2ProviderFlags; config: AuthConfig }> {
  const enabled = await isAuthEnabled(projectId);
  if (!enabled) {
    throw new Error('auth_not_enabled');
  }

  await updateAuthConfig(projectId, {
    providers: {
      emailPassword: { enabled: flags.emailPassword },
      magicLink: {
        enabled: flags.magicLink,
        expiryMinutes: 15,
      },
      emailOtp: {
        enabled: flags.emailOtp,
        codeLength: 6,
        expiryMinutes: 5,
      },
      passkey: { enabled: flags.passkey },
    },
  });
  await invalidateAuthInstance(projectId);

  // Proof: re-read from DB (not the in-memory merge result alone)
  const config = await getAuthConfig(projectId);
  return {
    enabled: true,
    providers: flagsFromConfig(config),
    config,
  };
}

/**
 * Snapshot for one project (config + enabled) after enable or for detail pages.
 */
export async function getAuthV2ProjectSnapshot(projectId: string): Promise<{
  enabled: boolean;
  providers: AuthV2ProviderFlags | null;
  twoFactor: AuthV2TwoFactorFlags | null;
  passwordPolicy: PasswordPolicy | null;
  config: AuthConfig | null;
}> {
  const enabled = await isAuthEnabled(projectId);
  if (!enabled) {
    return {
      enabled: false,
      providers: null,
      twoFactor: null,
      passwordPolicy: null,
      config: null,
    };
  }
  const config = await getAuthConfig(projectId);
  let passwordPolicy: PasswordPolicy | null = null;
  try {
    passwordPolicy = await getPasswordPolicy(projectId);
  } catch {
    passwordPolicy = null;
  }
  return {
    enabled: true,
    providers: flagsFromConfig(config),
    twoFactor: twoFactorFromConfig(config),
    passwordPolicy,
    config,
  };
}

/**
 * Phase 8.1 — save 2FA toggles (enables Better Auth twoFactor + 10 backup codes).
 * Returns live flags after invalidate + re-read.
 */
export async function saveAuthV2TwoFactor(
  projectId: string,
  input: { enabled: boolean; required: boolean },
): Promise<{ enabled: boolean; twoFactor: AuthV2TwoFactorFlags }> {
  const authOn = await isAuthEnabled(projectId);
  if (!authOn) throw new Error('auth_not_enabled');

  const flags = normalizeTwoFactorFlags(input);
  await updateAuthConfig(projectId, {
    twoFactor: {
      enabled: flags.enabled,
      required: flags.required,
      issuer: null,
    },
  });
  await invalidateAuthInstance(projectId);

  const config = await getAuthConfig(projectId);
  return { enabled: true, twoFactor: twoFactorFromConfig(config) };
}

/**
 * Phase 8.4 surface — password policy with read-back proof.
 */
export async function saveAuthV2PasswordPolicy(
  projectId: string,
  patch: Partial<PasswordPolicy>,
): Promise<{ enabled: boolean; passwordPolicy: PasswordPolicy }> {
  const authOn = await isAuthEnabled(projectId);
  if (!authOn) throw new Error('auth_not_enabled');

  const passwordPolicy = await setPasswordPolicy(projectId, patch);
  return { enabled: true, passwordPolicy };
}

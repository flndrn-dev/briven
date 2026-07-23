/**
 * briven-engine third-party social login (Google / GitHub first) on Doltgres.
 *
 * Flow:
 *  1) getAuthorisationUrl → browser → provider
 *  2) provider redirects with ?code=
 *  3) exchangeCodeForProfile → email + provider user id
 *  4) signInUpWithThirdPartyProfile → user + link + session on Doltgres
 */

import { randomBytes } from 'node:crypto';

import { newId } from '@briven/shared';

import { env } from '../../env.js';
import { log } from '../../lib/logger.js';
import { getEnginePool } from './db.js';
import { createEngineSession } from './native-session.js';
import { projectIdToTenantId } from './project-map.js';
import {
  loadProjectProviderSecrets,
  type ProjectProviderSecrets,
} from './project-config.js';
import type { BrivenSocialProviderId } from './providers.js';

export type SupportedSocial = 'google' | 'github' | 'konnos';

const OAUTH_STATE = new Map<
  string,
  { projectId: string; thirdPartyId: SupportedSocial; createdAt: number }
>();

function cleanState(): void {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [k, v] of OAUTH_STATE) {
    if (v.createdAt < cutoff) OAUTH_STATE.delete(k);
  }
}

async function ensureTenant(tenantId: string, projectId?: string): Promise<void> {
  const pool = getEnginePool();
  const existing = await pool.query(
    `SELECT tenant_id FROM be_tenants WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  if (!existing.rowCount) {
    await pool.query(
      `INSERT INTO be_tenants (tenant_id, project_id) VALUES ($1, $2)`,
      [tenantId, projectId ?? tenantId],
    );
  }
}

/**
 * Resolve client id/secret: project secrets first, then platform env fallbacks.
 */
export async function resolveProviderCredentials(
  projectId: string | undefined,
  thirdPartyId: SupportedSocial,
): Promise<{ clientId: string; clientSecret: string; source: string } | null> {
  if (projectId) {
    try {
      const secrets = await loadProjectProviderSecrets(projectId);
      const hit = secrets.find((s) => s.thirdPartyId === thirdPartyId);
      if (hit?.clientId && hit?.clientSecret) {
        return {
          clientId: hit.clientId,
          clientSecret: hit.clientSecret,
          source: 'project_secrets',
        };
      }
    } catch {
      // secrets table / master key may be unavailable in bare local proof
    }
  }

  if (thirdPartyId === 'google') {
    const clientId = process.env.BRIVEN_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.BRIVEN_GOOGLE_CLIENT_SECRET;
    if (clientId && clientSecret) {
      return { clientId, clientSecret, source: 'platform_env' };
    }
  }
  if (thirdPartyId === 'github') {
    const clientId = process.env.BRIVEN_GITHUB_CLIENT_ID;
    const clientSecret = process.env.BRIVEN_GITHUB_CLIENT_SECRET;
    if (clientId && clientSecret) {
      return { clientId, clientSecret, source: 'platform_env' };
    }
  }
  if (thirdPartyId === 'konnos') {
    const clientId = process.env.BRIVEN_KONNOS_CLIENT_ID;
    const clientSecret = process.env.BRIVEN_KONNOS_CLIENT_SECRET;
    if (clientId && clientSecret) {
      return { clientId, clientSecret, source: 'platform_env' };
    }
  }
  return null;
}

export type AuthorisationUrlResult =
  | {
      status: 'OK';
      urlWithQueryParams: string;
      state: string;
      thirdPartyId: SupportedSocial;
      credentialsSource: string;
    }
  | { status: 'NO_CREDENTIALS' | 'BAD_REQUEST'; message: string };

/**
 * Build provider authorisation URL (step 1 of OAuth).
 */
export async function getAuthorisationUrl(input: {
  thirdPartyId: SupportedSocial;
  redirectURI: string;
  projectId?: string;
}): Promise<AuthorisationUrlResult> {
  if (
    input.thirdPartyId !== 'google' &&
    input.thirdPartyId !== 'github' &&
    input.thirdPartyId !== 'konnos'
  ) {
    return {
      status: 'BAD_REQUEST',
      message: 'supported: google, github, konnos',
    };
  }
  if (!input.redirectURI) {
    return { status: 'BAD_REQUEST', message: 'redirectURI required' };
  }

  const creds = await resolveProviderCredentials(
    input.projectId,
    input.thirdPartyId,
  );
  if (!creds) {
    return {
      status: 'NO_CREDENTIALS',
      message:
        'Set project OAuth secrets (Providers) or BRIVEN_GOOGLE_* / BRIVEN_GITHUB_* / BRIVEN_KONNOS_* env',
    };
  }

  cleanState();
  const state = randomBytes(16).toString('hex');
  OAUTH_STATE.set(state, {
    projectId: input.projectId ?? '',
    thirdPartyId: input.thirdPartyId,
    createdAt: Date.now(),
  });

  if (input.thirdPartyId === 'google') {
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', creds.clientId);
    u.searchParams.set('redirect_uri', input.redirectURI);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'openid email profile');
    u.searchParams.set('access_type', 'online');
    u.searchParams.set('include_granted_scopes', 'true');
    u.searchParams.set('state', state);
    return {
      status: 'OK',
      urlWithQueryParams: u.toString(),
      state,
      thirdPartyId: 'google',
      credentialsSource: creds.source,
    };
  }

  if (input.thirdPartyId === 'konnos') {
    // Konnos as OAuth IdP (code.konnos.org / konnos.org Applications)
    const base = (
      process.env.BRIVEN_KONNOS_OAUTH_ORIGIN ?? 'https://konnos.org'
    ).replace(/\/$/, '');
    const u = new URL(`${base}/login/oauth/authorize`);
    u.searchParams.set('client_id', creds.clientId);
    u.searchParams.set('redirect_uri', input.redirectURI);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'read:user');
    u.searchParams.set('state', state);
    return {
      status: 'OK',
      urlWithQueryParams: u.toString(),
      state,
      thirdPartyId: 'konnos',
      credentialsSource: creds.source,
    };
  }

  // GitHub
  const u = new URL('https://github.com/login/oauth/authorize');
  u.searchParams.set('client_id', creds.clientId);
  u.searchParams.set('redirect_uri', input.redirectURI);
  u.searchParams.set('scope', 'user:email');
  u.searchParams.set('state', state);
  return {
    status: 'OK',
    urlWithQueryParams: u.toString(),
    state,
    thirdPartyId: 'github',
    credentialsSource: creds.source,
  };
}

export type OAuthProfile = {
  thirdPartyId: SupportedSocial;
  thirdPartyUserId: string;
  email: string | null;
  emailVerified: boolean;
  name?: string | null;
};

/**
 * Exchange authorization code for a profile (real provider HTTP).
 */
export async function exchangeCodeForProfile(input: {
  thirdPartyId: SupportedSocial;
  code: string;
  redirectURI: string;
  projectId?: string;
  state?: string;
}): Promise<
  | { status: 'OK'; profile: OAuthProfile; projectId?: string }
  | { status: 'ERROR'; message: string }
> {
  let projectId = input.projectId;
  if (input.state) {
    const st = OAUTH_STATE.get(input.state);
    if (!st || st.thirdPartyId !== input.thirdPartyId) {
      return { status: 'ERROR', message: 'invalid or expired OAuth state' };
    }
    if (st.projectId) projectId = st.projectId;
    OAUTH_STATE.delete(input.state);
  }

  const creds = await resolveProviderCredentials(
    projectId,
    input.thirdPartyId,
  );
  if (!creds) {
    return { status: 'ERROR', message: 'no credentials for provider' };
  }

  try {
    if (input.thirdPartyId === 'google') {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: input.code,
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          redirect_uri: input.redirectURI,
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (!tokenRes.ok) {
        const t = await tokenRes.text();
        return {
          status: 'ERROR',
          message: `google token ${tokenRes.status}: ${t.slice(0, 120)}`,
        };
      }
      const tokenJson = (await tokenRes.json()) as { access_token?: string };
      if (!tokenJson.access_token) {
        return { status: 'ERROR', message: 'google: no access_token' };
      }
      const userRes = await fetch(
        'https://www.googleapis.com/oauth2/v3/userinfo',
        {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` },
          signal: AbortSignal.timeout(12000),
        },
      );
      if (!userRes.ok) {
        return {
          status: 'ERROR',
          message: `google userinfo ${userRes.status}`,
        };
      }
      const user = (await userRes.json()) as {
        sub?: string;
        email?: string;
        email_verified?: boolean;
        name?: string;
      };
      if (!user.sub) {
        return { status: 'ERROR', message: 'google: no sub' };
      }
      return {
        status: 'OK',
        projectId,
        profile: {
          thirdPartyId: 'google',
          thirdPartyUserId: user.sub,
          email: user.email ?? null,
          emailVerified: Boolean(user.email_verified),
          name: user.name ?? null,
        },
      };
    }

    if (input.thirdPartyId === 'konnos') {
      const origin = (
        process.env.BRIVEN_KONNOS_OAUTH_ORIGIN ?? 'https://konnos.org'
      ).replace(/\/$/, '');
      const tokenRes = await fetch(`${origin}/login/oauth/access_token`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          code: input.code,
          redirect_uri: input.redirectURI,
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (!tokenRes.ok) {
        const t = await tokenRes.text();
        return {
          status: 'ERROR',
          message: `konnos token ${tokenRes.status}: ${t.slice(0, 120)}`,
        };
      }
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        error?: string;
      };
      if (!tokenJson.access_token) {
        return {
          status: 'ERROR',
          message: tokenJson.error ?? 'konnos: no access_token',
        };
      }
      const userRes = await fetch(`${origin}/api/user`, {
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!userRes.ok) {
        return { status: 'ERROR', message: `konnos user ${userRes.status}` };
      }
      const user = (await userRes.json()) as {
        id?: string | number;
        email?: string | null;
        name?: string | null;
        login?: string | null;
      };
      if (user.id == null) {
        return { status: 'ERROR', message: 'konnos: no id' };
      }
      return {
        status: 'OK',
        projectId,
        profile: {
          thirdPartyId: 'konnos',
          thirdPartyUserId: String(user.id),
          email: user.email ?? null,
          emailVerified: Boolean(user.email),
          name: user.name ?? user.login ?? null,
        },
      };
    }

    // GitHub
    const tokenRes = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          code: input.code,
          redirect_uri: input.redirectURI,
        }),
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!tokenRes.ok) {
      return { status: 'ERROR', message: `github token ${tokenRes.status}` };
    }
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
    };
    if (!tokenJson.access_token) {
      return {
        status: 'ERROR',
        message: tokenJson.error ?? 'github: no access_token',
      };
    }
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'briven-engine',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!userRes.ok) {
      return { status: 'ERROR', message: `github user ${userRes.status}` };
    }
    const user = (await userRes.json()) as {
      id?: number;
      email?: string | null;
      name?: string | null;
      login?: string;
    };
    let email = user.email ?? null;
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'briven-engine',
        },
        signal: AbortSignal.timeout(12000),
      });
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as Array<{
          email: string;
          primary?: boolean;
          verified?: boolean;
        }>;
        const primary =
          emails.find((e) => e.primary && e.verified) ??
          emails.find((e) => e.verified) ??
          emails[0];
        email = primary?.email ?? null;
      }
    }
    if (user.id == null) {
      return { status: 'ERROR', message: 'github: no id' };
    }
    return {
      status: 'OK',
      projectId,
      profile: {
        thirdPartyId: 'github',
        thirdPartyUserId: String(user.id),
        email,
        emailVerified: Boolean(email),
        name: user.name ?? user.login ?? null,
      },
    };
  } catch (err) {
    return {
      status: 'ERROR',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export type SignInUpResult =
  | {
      status: 'OK';
      createdNewUser: boolean;
      user: {
        id: string;
        email: string | null;
        tenantId: string;
        thirdPartyId: SupportedSocial;
        thirdPartyUserId: string;
      };
      session: {
        handle: string;
        userId: string;
        accessToken: string;
        refreshToken: string;
      };
    }
  | { status: 'ERROR'; message: string };

/**
 * Upsert user + third-party link on Doltgres, create session.
 * Call after a successful code exchange (or local proof profile).
 */
export async function signInUpWithThirdPartyProfile(input: {
  profile: OAuthProfile;
  projectId?: string;
  tenantId?: string;
}): Promise<SignInUpResult> {
  const tenantId =
    input.tenantId ??
    (input.projectId ? projectIdToTenantId(input.projectId) : 'public');
  await ensureTenant(tenantId, input.projectId);

  const pool = getEnginePool();
  const { thirdPartyId, thirdPartyUserId } = input.profile;
  const email = input.profile.email?.trim().toLowerCase() ?? null;

  // Existing link?
  const link = await pool.query(
    `SELECT user_id FROM be_third_party_links
     WHERE tenant_id = $1 AND third_party_id = $2 AND third_party_user_id = $3
     LIMIT 1`,
    [tenantId, thirdPartyId, thirdPartyUserId],
  );

  let userId: string;
  let createdNewUser = false;

  if (link.rows[0]) {
    userId = (link.rows[0] as { user_id: string }).user_id;
  } else {
    // Optional: match existing email user in tenant
    if (email) {
      const byEmail = await pool.query(
        `SELECT id FROM be_users WHERE tenant_id = $1 AND email = $2 LIMIT 1`,
        [tenantId, email],
      );
      if (byEmail.rows[0]) {
        userId = (byEmail.rows[0] as { id: string }).id;
      } else {
        userId = newId('beu');
        createdNewUser = true;
        await pool.query(
          `INSERT INTO be_users (id, tenant_id, email, email_verified)
           VALUES ($1, $2, $3, $4)`,
          [
            userId,
            tenantId,
            email,
            input.profile.emailVerified,
          ],
        );
      }
    } else {
      userId = newId('beu');
      createdNewUser = true;
      await pool.query(
        `INSERT INTO be_users (id, tenant_id, email, email_verified)
         VALUES ($1, $2, NULL, FALSE)`,
        [userId, tenantId],
      );
    }

    await pool.query(
      `INSERT INTO be_third_party_links
        (id, user_id, tenant_id, third_party_id, third_party_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [newId('btp'), userId, tenantId, thirdPartyId, thirdPartyUserId],
    );
  }

  const session = await createEngineSession({ userId, tenantId });

  log.info('briven_engine_thirdparty_signin', {
    engine: 'briven-engine',
    storage: 'doltgres',
    thirdPartyId,
    createdNewUser,
    tenantId,
  });

  return {
    status: 'OK',
    createdNewUser,
    user: {
      id: userId,
      email,
      tenantId,
      thirdPartyId,
      thirdPartyUserId,
    },
    session: {
      handle: session.sessionHandle,
      userId: session.userId,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    },
  };
}

/**
 * Full OAuth code path: exchange + sign-in/up.
 */
export async function signInUpWithCode(input: {
  thirdPartyId: SupportedSocial;
  code: string;
  redirectURI: string;
  projectId?: string;
  state?: string;
}): Promise<SignInUpResult> {
  const exchanged = await exchangeCodeForProfile(input);
  if (exchanged.status !== 'OK') {
    return { status: 'ERROR', message: exchanged.message };
  }
  return signInUpWithThirdPartyProfile({
    profile: exchanged.profile,
    projectId: exchanged.projectId ?? input.projectId,
  });
}

/** @internal test helper — list pending OAuth states count */
export function __oauthStateSizeForTests(): number {
  cleanState();
  return OAUTH_STATE.size;
}

void env; // reserved

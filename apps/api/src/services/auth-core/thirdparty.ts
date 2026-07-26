/**
 * briven-engine third-party social login on Doltgres.
 *
 * Full catalog (Konnos, Google, GitHub, Discord, Apple, Microsoft, Facebook,
 * X/Twitter, LinkedIn, GitLab, Bitbucket, Spotify).
 *
 * Flow:
 *  1) getAuthorisationUrl → browser → provider
 *  2) provider redirects with ?code=
 *  3) exchangeCodeForProfile → email + provider user id
 *  4) signInUpWithThirdPartyProfile → user + link + session on Doltgres
 */

import { createSign, randomBytes } from 'node:crypto';

import { newId } from '@briven/shared';

import { env } from '../../env.js';
import { log } from '../../lib/logger.js';
import { getEnginePool } from './db.js';
import { createEngineSession } from './native-session.js';
import { projectIdToTenantId } from './project-map.js';
import {
  loadProjectProviderSecrets,
} from './project-config.js';
import type { BrivenSocialProviderId } from './providers.js';

/** All catalog providers that can run OAuth login when secrets are set. */
export type SupportedSocial = BrivenSocialProviderId;

/**
 * "Sign in with Konnos" product OAuth host (konnos.org).
 * Not the Git forge at code.konnos.org — kc_* apps are registered under
 * konnos.org → Settings → Applications.
 * Override with BRIVEN_KONNOS_OAUTH_ORIGIN if needed.
 */
function konnosOAuthOrigin(): string {
  const raw =
    process.env.BRIVEN_KONNOS_OAUTH_ORIGIN ??
    process.env.BRIVEN_KONNOS_ISSUER ??
    'https://konnos.org';
  // Legacy misconfig: code.konnos.org is Gogs/Git, not Sign-in with Konnos.
  if (/^https?:\/\/code\.konnos\.org\/?$/i.test(raw.replace(/\/$/, ''))) {
    return 'https://konnos.org';
  }
  return raw.replace(/\/$/, '');
}

type OAuthProviderEndpoints = {
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl?: string;
  /** Space-separated OAuth scopes */
  scope: string;
  /** How to POST the token request */
  tokenBody: 'json' | 'form';
  /** Extra authorize query params */
  authorizeExtra?: Record<string, string>;
  /**
   * Parse access_token + profile from token/userinfo responses.
   * Defaults: standard OAuth2 JSON userinfo.
   */
  profileFrom?: 'userinfo' | 'apple_id_token' | 'twitter_v2';
};

const OAUTH_ENDPOINTS: Record<SupportedSocial, OAuthProviderEndpoints> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scope: 'openid email profile',
    tokenBody: 'form',
    authorizeExtra: {
      access_type: 'online',
      include_granted_scopes: 'true',
    },
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scope: 'user:email',
    tokenBody: 'json',
  },
  // Sign in with Konnos (product) — paths from konnos apps/web OAuth provider.
  konnos: {
    authorizeUrl: `${konnosOAuthOrigin()}/login/oauth/authorize`,
    tokenUrl: `${konnosOAuthOrigin()}/login/oauth/access_token`,
    userInfoUrl: `${konnosOAuthOrigin()}/api/user`,
    scope: 'read:user',
    tokenBody: 'json',
  },
  discord: {
    authorizeUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userInfoUrl: 'https://discord.com/api/users/@me',
    scope: 'identify email',
    tokenBody: 'form',
  },
  microsoft: {
    authorizeUrl:
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scope: 'openid email profile User.Read',
    tokenBody: 'form',
  },
  facebook: {
    authorizeUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
    userInfoUrl:
      'https://graph.facebook.com/me?fields=id,name,email',
    scope: 'email,public_profile',
    tokenBody: 'form',
  },
  twitter: {
    // X OAuth 2.0
    authorizeUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    userInfoUrl:
      'https://api.twitter.com/2/users/me?user.fields=id,name,username',
    scope: 'users.read tweet.read offline.access',
    tokenBody: 'form',
    authorizeExtra: { code_challenge_method: 'plain' },
    profileFrom: 'twitter_v2',
  },
  linkedin: {
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    userInfoUrl: 'https://api.linkedin.com/v2/userinfo',
    scope: 'openid profile email',
    tokenBody: 'form',
  },
  gitlab: {
    authorizeUrl: 'https://gitlab.com/oauth/authorize',
    tokenUrl: 'https://gitlab.com/oauth/token',
    userInfoUrl: 'https://gitlab.com/api/v4/user',
    scope: 'read_user',
    tokenBody: 'form',
  },
  bitbucket: {
    authorizeUrl: 'https://bitbucket.org/site/oauth2/authorize',
    tokenUrl: 'https://bitbucket.org/site/oauth2/access_token',
    userInfoUrl: 'https://api.bitbucket.org/2.0/user',
    scope: 'account email',
    tokenBody: 'form',
  },
  spotify: {
    authorizeUrl: 'https://accounts.spotify.com/authorize',
    tokenUrl: 'https://accounts.spotify.com/api/token',
    userInfoUrl: 'https://api.spotify.com/v1/me',
    scope: 'user-read-email',
    tokenBody: 'form',
  },
  apple: {
    authorizeUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    scope: 'name email',
    tokenBody: 'form',
    authorizeExtra: { response_mode: 'form_post' },
    profileFrom: 'apple_id_token',
  },
};

const ALL_SOCIAL = Object.keys(OAUTH_ENDPOINTS) as SupportedSocial[];

const OAUTH_STATE = new Map<
  string,
  {
    projectId: string;
    thirdPartyId: SupportedSocial;
    createdAt: number;
    /** PKCE verifier for X/Twitter */
    codeVerifier?: string;
  }
>();

function cleanState(): void {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [k, v] of OAUTH_STATE) {
    if (v.createdAt < cutoff) OAUTH_STATE.delete(k);
  }
}

function isSupported(id: string): id is SupportedSocial {
  return ALL_SOCIAL.includes(id as SupportedSocial);
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
      // secrets table / master key may be unavailable
    }
  }

  const envMap: Partial<Record<SupportedSocial, [string, string]>> = {
    google: ['BRIVEN_GOOGLE_CLIENT_ID', 'BRIVEN_GOOGLE_CLIENT_SECRET'],
    github: ['BRIVEN_GITHUB_CLIENT_ID', 'BRIVEN_GITHUB_CLIENT_SECRET'],
    konnos: ['BRIVEN_KONNOS_CLIENT_ID', 'BRIVEN_KONNOS_CLIENT_SECRET'],
    discord: ['BRIVEN_DISCORD_CLIENT_ID', 'BRIVEN_DISCORD_CLIENT_SECRET'],
    microsoft: [
      'BRIVEN_MICROSOFT_CLIENT_ID',
      'BRIVEN_MICROSOFT_CLIENT_SECRET',
    ],
    facebook: ['BRIVEN_FACEBOOK_CLIENT_ID', 'BRIVEN_FACEBOOK_CLIENT_SECRET'],
    twitter: ['BRIVEN_TWITTER_CLIENT_ID', 'BRIVEN_TWITTER_CLIENT_SECRET'],
    linkedin: ['BRIVEN_LINKEDIN_CLIENT_ID', 'BRIVEN_LINKEDIN_CLIENT_SECRET'],
    gitlab: ['BRIVEN_GITLAB_CLIENT_ID', 'BRIVEN_GITLAB_CLIENT_SECRET'],
    bitbucket: [
      'BRIVEN_BITBUCKET_CLIENT_ID',
      'BRIVEN_BITBUCKET_CLIENT_SECRET',
    ],
    spotify: ['BRIVEN_SPOTIFY_CLIENT_ID', 'BRIVEN_SPOTIFY_CLIENT_SECRET'],
    apple: ['BRIVEN_APPLE_CLIENT_ID', 'BRIVEN_APPLE_CLIENT_SECRET'],
  };
  const keys = envMap[thirdPartyId];
  if (keys) {
    const clientId = process.env[keys[0]];
    const clientSecret = process.env[keys[1]];
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
  thirdPartyId: SupportedSocial | string;
  redirectURI: string;
  projectId?: string;
}): Promise<AuthorisationUrlResult> {
  if (!isSupported(input.thirdPartyId)) {
    return {
      status: 'BAD_REQUEST',
      message: `unsupported provider: ${input.thirdPartyId}`,
    };
  }
  if (!input.redirectURI) {
    return { status: 'BAD_REQUEST', message: 'redirectURI required' };
  }

  const thirdPartyId = input.thirdPartyId;
  const endpoints = OAUTH_ENDPOINTS[thirdPartyId];
  const creds = await resolveProviderCredentials(
    input.projectId,
    thirdPartyId,
  );
  if (!creds) {
    return {
      status: 'NO_CREDENTIALS',
      message:
        `Set project OAuth secrets for ${thirdPartyId} under Providers (client id + secret). ` +
        `If the dashboard already shows “set”, paste both values again and click save — ` +
        `stale secrets after a key change cannot be read for login.`,
    };
  }

  cleanState();
  const state = randomBytes(16).toString('hex');
  let codeVerifier: string | undefined;
  if (thirdPartyId === 'twitter') {
    // PKCE plain (simple); production apps may prefer S256 later
    codeVerifier = randomBytes(32).toString('base64url');
  }
  OAUTH_STATE.set(state, {
    projectId: input.projectId ?? '',
    thirdPartyId,
    createdAt: Date.now(),
    codeVerifier,
  });

  const u = new URL(endpoints.authorizeUrl);
  u.searchParams.set('client_id', creds.clientId);
  u.searchParams.set('redirect_uri', input.redirectURI);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', endpoints.scope);
  u.searchParams.set('state', state);
  if (endpoints.authorizeExtra) {
    for (const [k, v] of Object.entries(endpoints.authorizeExtra)) {
      u.searchParams.set(k, v);
    }
  }
  if (codeVerifier) {
    u.searchParams.set('code_challenge', codeVerifier);
  }

  return {
    status: 'OK',
    urlWithQueryParams: u.toString(),
    state,
    thirdPartyId,
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
  thirdPartyId: SupportedSocial | string;
  code: string;
  redirectURI: string;
  projectId?: string;
  state?: string;
}): Promise<
  | { status: 'OK'; profile: OAuthProfile; projectId?: string }
  | { status: 'ERROR'; message: string }
> {
  if (!isSupported(input.thirdPartyId)) {
    return { status: 'ERROR', message: `unsupported provider: ${input.thirdPartyId}` };
  }
  const thirdPartyId = input.thirdPartyId;
  let projectId = input.projectId;
  let codeVerifier: string | undefined;
  if (input.state) {
    const st = OAUTH_STATE.get(input.state);
    if (!st || st.thirdPartyId !== thirdPartyId) {
      return { status: 'ERROR', message: 'invalid or expired OAuth state' };
    }
    if (st.projectId) projectId = st.projectId;
    codeVerifier = st.codeVerifier;
    OAUTH_STATE.delete(input.state);
  }

  const endpoints = OAUTH_ENDPOINTS[thirdPartyId];
  const creds = await resolveProviderCredentials(projectId, thirdPartyId);
  if (!creds) {
    return { status: 'ERROR', message: 'no credentials for provider' };
  }

  try {
    // ── token ──
    let accessToken: string | undefined;
    let idToken: string | undefined;

    if (thirdPartyId === 'apple') {
      // Apple client_secret is often a JWT signed with .p8; accept raw secret
      // from Providers if operator pastes a pre-built JWT secret.
      const body = new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        code: input.code,
        grant_type: 'authorization_code',
        redirect_uri: input.redirectURI,
      });
      const tokenRes = await fetch(endpoints.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(15000),
      });
      if (!tokenRes.ok) {
        const t = await tokenRes.text();
        return {
          status: 'ERROR',
          message: `apple token ${tokenRes.status}: ${t.slice(0, 160)}`,
        };
      }
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        id_token?: string;
      };
      accessToken = tokenJson.access_token;
      idToken = tokenJson.id_token;
    } else if (endpoints.tokenBody === 'json') {
      const tokenRes = await fetch(endpoints.tokenUrl, {
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
          grant_type: 'authorization_code',
          ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!tokenRes.ok) {
        const t = await tokenRes.text();
        return {
          status: 'ERROR',
          message: `${thirdPartyId} token ${tokenRes.status}: ${t.slice(0, 160)}`,
        };
      }
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        error?: string;
      };
      accessToken = tokenJson.access_token;
      if (!accessToken) {
        return {
          status: 'ERROR',
          message: tokenJson.error ?? `${thirdPartyId}: no access_token`,
        };
      }
    } else {
      // form-urlencoded token (most providers)
      const params = new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        code: input.code,
        redirect_uri: input.redirectURI,
        grant_type: 'authorization_code',
      });
      if (codeVerifier) params.set('code_verifier', codeVerifier);
      const headers: Record<string, string> = {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      };
      // Spotify / Bitbucket often want Basic auth for token
      if (thirdPartyId === 'spotify' || thirdPartyId === 'bitbucket') {
        headers.authorization = `Basic ${Buffer.from(
          `${creds.clientId}:${creds.clientSecret}`,
        ).toString('base64')}`;
      }
      const tokenRes = await fetch(endpoints.tokenUrl, {
        method: 'POST',
        headers,
        body: params,
        signal: AbortSignal.timeout(15000),
      });
      if (!tokenRes.ok) {
        const t = await tokenRes.text();
        return {
          status: 'ERROR',
          message: `${thirdPartyId} token ${tokenRes.status}: ${t.slice(0, 160)}`,
        };
      }
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        id_token?: string;
        error?: string;
      };
      accessToken = tokenJson.access_token;
      idToken = tokenJson.id_token;
      if (!accessToken && !idToken) {
        return {
          status: 'ERROR',
          message: tokenJson.error ?? `${thirdPartyId}: no access_token`,
        };
      }
    }

    // ── profile ──
    if (endpoints.profileFrom === 'apple_id_token' && idToken) {
      const payload = decodeJwtPayload(idToken);
      const sub = payload.sub as string | undefined;
      if (!sub) return { status: 'ERROR', message: 'apple: no sub in id_token' };
      return {
        status: 'OK',
        projectId,
        profile: {
          thirdPartyId: 'apple',
          thirdPartyUserId: sub,
          email: (payload.email as string | undefined) ?? null,
          emailVerified: payload.email_verified === true || payload.email_verified === 'true',
          name: null,
        },
      };
    }

    if (!accessToken) {
      return { status: 'ERROR', message: `${thirdPartyId}: no access_token` };
    }
    if (!endpoints.userInfoUrl) {
      return { status: 'ERROR', message: `${thirdPartyId}: no userInfoUrl` };
    }

    const userRes = await fetch(endpoints.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'briven-engine',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!userRes.ok) {
      return {
        status: 'ERROR',
        message: `${thirdPartyId} userinfo ${userRes.status}`,
      };
    }
    const user = (await userRes.json()) as Record<string, unknown>;

    // GitHub: fill email from /user/emails if missing
    if (thirdPartyId === 'github' && !user.email) {
      try {
        const emailsRes = await fetch('https://api.github.com/user/emails', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
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
          if (primary?.email) user.email = primary.email;
        }
      } catch {
        /* ignore */
      }
    }

    // Bitbucket emails
    if (thirdPartyId === 'bitbucket' && !user.email) {
      try {
        const emailsRes = await fetch(
          'https://api.bitbucket.org/2.0/user/emails',
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(12000),
          },
        );
        if (emailsRes.ok) {
          const body = (await emailsRes.json()) as {
            values?: Array<{ email?: string; is_primary?: boolean }>;
          };
          const primary =
            body.values?.find((e) => e.is_primary) ?? body.values?.[0];
          if (primary?.email) user.email = primary.email;
        }
      } catch {
        /* ignore */
      }
    }

    const profile = normalizeProfile(thirdPartyId, user);
    if (!profile) {
      return { status: 'ERROR', message: `${thirdPartyId}: could not parse user id` };
    }
    return { status: 'OK', projectId, profile };
  } catch (err) {
    return {
      status: 'ERROR',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length < 2) return {};
  try {
    const json = Buffer.from(parts[1]!, 'base64url').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeProfile(
  thirdPartyId: SupportedSocial,
  user: Record<string, unknown>,
): OAuthProfile | null {
  // Twitter v2 wraps data
  if (thirdPartyId === 'twitter' && user.data && typeof user.data === 'object') {
    const d = user.data as Record<string, unknown>;
    const id = d.id != null ? String(d.id) : null;
    if (!id) return null;
    return {
      thirdPartyId,
      thirdPartyUserId: id,
      email: null, // X free tier often has no email
      emailVerified: false,
      name: (d.name as string | undefined) ?? (d.username as string | undefined) ?? null,
    };
  }

  // Microsoft Graph uses id + mail / userPrincipalName
  if (thirdPartyId === 'microsoft') {
    const id = user.id != null ? String(user.id) : null;
    if (!id) return null;
    const email =
      (user.mail as string | undefined) ??
      (user.userPrincipalName as string | undefined) ??
      null;
    return {
      thirdPartyId,
      thirdPartyUserId: id,
      email,
      emailVerified: Boolean(email),
      name: (user.displayName as string | undefined) ?? null,
    };
  }

  // LinkedIn OIDC userinfo
  if (thirdPartyId === 'linkedin') {
    const id = (user.sub as string | undefined) ?? null;
    if (!id) return null;
    return {
      thirdPartyId,
      thirdPartyUserId: id,
      email: (user.email as string | undefined) ?? null,
      emailVerified: user.email_verified === true,
      name: (user.name as string | undefined) ?? null,
    };
  }

  // Google / Discord / Facebook / GitLab / Spotify / GitHub / Konnos common shapes
  const id =
    user.sub != null
      ? String(user.sub)
      : user.id != null
        ? String(user.id)
        : null;
  if (!id) return null;
  const email =
    typeof user.email === 'string'
      ? user.email
      : null;
  const name =
    (typeof user.name === 'string' && user.name) ||
    (typeof user.login === 'string' && user.login) ||
    (typeof user.username === 'string' && user.username) ||
    (typeof user.global_name === 'string' && user.global_name) ||
    null;

  return {
    thirdPartyId,
    thirdPartyUserId: id,
    email,
    emailVerified:
      user.email_verified === true ||
      user.verified === true ||
      Boolean(email),
    name,
  };
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
          [userId, tenantId, email, input.profile.emailVerified],
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

  const { recordBrivenEngineAudit } = await import('./audit.js');
  void recordBrivenEngineAudit({
    action: 'signin.social',
    tenantId,
    projectId: input.projectId,
    userId,
    metadata: {
      thirdPartyId,
      createdNewUser,
      email: email ?? null,
    },
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

/** @internal test helper */
export function __oauthStateSizeForTests(): number {
  cleanState();
  return OAUTH_STATE.size;
}

export function listSupportedSocialProviders(): SupportedSocial[] {
  return [...ALL_SOCIAL];
}

// keep env referenced for future Apple .p8 JWT minting
void env;
void createSign;

/**
 * @briven/auth — drop-in authentication for briven projects.
 *
 *   import { createBrivenAuth } from '@briven/auth';
 *
 *   export const auth = createBrivenAuth({
 *     projectId: 'p_abc123',
 *     publicKey: 'pk_briven_auth_...',
 *   });
 *
 *   const { ok, userId } = await auth.signIn.email({
 *     email: 'jane@example.com',
 *     password: '...',
 *   });
 *
 * Subpaths:
 *   - `@briven/auth`         → vanilla fetch client (zero React deps)
 *   - `@briven/auth/react`   → hooks + `<BrivenSignIn />` component
 *   - `@briven/auth/server`  → Next.js App Router helpers
 *
 * Wire protocol: every request carries `x-briven-project-id: <projectId>`
 * and `authorization: Bearer <publicKey>`. The api resolves the tenant
 * from the header, pulls the right Better Auth instance from the pool,
 * and forwards to Better Auth's internal handler. Cookies carry the
 * session token (`Set-Cookie` on the api response; SDK uses
 * `credentials: 'include'` so the browser stores it).
 */

export type OAuthProvider =
  | 'google'
  | 'github'
  | 'discord'
  | 'microsoft'
  | 'apple'
  | 'twitter'
  | 'linkedin'
  | 'gitlab'
  | 'bitbucket'
  | 'dropbox'
  | 'facebook'
  | 'spotify';

export interface CreateBrivenAuthOptions {
  /** briven project id (`p_<ulid>`). Required. */
  readonly projectId: string;
  /** SDK key issued from the dashboard's Auth → API Keys panel. Required. */
  readonly publicKey: string;
  /**
   * Override for the api origin. Defaults to `https://api.briven.tech`.
   * Useful for self-hosted briven installations or local dev.
   */
  readonly apiOrigin?: string;
  /**
   * Override for the hosted-pages base URL. Defaults to
   * `https://<projectId>.auth.briven.tech`. Used by `signIn.social()` to
   * build redirect URLs that survive the OAuth handshake.
   */
  readonly authUrl?: string;
  /**
   * Optional fetch implementation. Defaults to `globalThis.fetch`. Tests
   * pass a stub here; production code never needs to set this.
   */
  readonly fetch?: typeof globalThis.fetch;
}

export interface User {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string | null;
  readonly image: string | null;
  readonly createdAt: string;
}

export interface Session {
  readonly userId: string;
  readonly expiresAt: string;
}

export interface ClientSession {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
}

export type SignInErrorCode =
  | 'invalid_credentials'
  | 'email_taken'
  | 'weak_password'
  | 'rate_limited'
  | 'unverified_email'
  | 'tenant_unresolved'
  | 'network_error'
  | 'unknown';

export type SignInResult =
  | { ok: true; userId: string; sessionExpiresAt: string }
  /**
   * Password (or other first factor) succeeded but the account has 2FA on.
   * Caller must complete the challenge with `twoFactor.verify` (TOTP) or
   * `twoFactor.verifyBackupCode` (single-use recovery codes). The interim
   * two-factor cookie is already set via credentials: 'include'.
   */
  | { ok: true; twoFactorRequired: true }
  | { ok: false; code: SignInErrorCode; message: string };

export type SimpleResult =
  | { ok: true }
  | { ok: false; code: SignInErrorCode; message: string };

export type MagicLinkResult = SimpleResult;
export type OtpRequestResult = SimpleResult;
export type PasswordResetResult = SimpleResult;

export type SessionResponse =
  | { authenticated: true; userId: string; expiresAt: string }
  | { authenticated: false };

export interface SignInEmailInput {
  email: string;
  password: string;
}

export interface SignUpEmailInput {
  email: string;
  password: string;
  name?: string;
}

export interface MagicLinkInput {
  email: string;
  /** Optional URL the customer's app wants the user to land on post-verify. */
  redirectTo?: string;
}

export interface OtpVerifyInput {
  email: string;
  otp: string;
}

export interface SocialInput {
  provider: OAuthProvider;
  /** Optional URL the customer's app wants the user to land on post-callback. */
  redirectTo?: string;
}

export interface PasswordResetInput {
  token: string;
  newPassword: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface UpdateUserInput {
  name?: string;
  image?: string;
}

// ─── Organizations (Phase 2) ──────────────────────────────────────────────

export interface Org {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logo: string | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

export interface OrgMember {
  readonly id: string;
  readonly orgId: string;
  readonly userId: string;
  readonly role: 'owner' | 'admin' | 'member';
  readonly createdAt: string;
}

export interface OrgInvite {
  readonly id: string;
  readonly orgId: string;
  readonly email: string;
  readonly role: 'owner' | 'admin' | 'member';
  readonly token: string;
  readonly expiresAt: string;
  readonly invitedBy: string | null;
  readonly acceptedAt: string | null;
  readonly createdAt: string;
}

export type OrgResult<T> = { ok: true; data: T } | { ok: false; code: SignInErrorCode; message: string };

// ─── Phase 4 — Organizations & B2B ────────────────────────────────────────

export type OrgPermission =
  | 'org:update'
  | 'org:delete'
  | 'member:add'
  | 'member:remove'
  | 'member:update_role'
  | 'invite:create'
  | 'invite:revoke'
  | 'invite:list'
  | 'domain:manage'
  | 'request:approve'
  | 'billing:view'
  | 'billing:manage';

export interface OrgRole {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly permissions: OrgPermission[];
  readonly isSystem: boolean;
  readonly createdAt: string;
}

export interface OrgDomain {
  readonly id: string;
  readonly orgId: string;
  readonly domain: string;
  readonly verificationToken: string;
  readonly verifiedAt: string | null;
  readonly autoJoinEnabled: boolean;
  readonly createdAt: string;
}

export interface MembershipRequest {
  readonly id: string;
  readonly orgId: string;
  readonly userId: string;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly message: string | null;
  readonly requestedAt: string;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
  readonly createdAt: string;
}

// ─── Phase 5 — Enterprise SSO ─────────────────────────────────────────────

export type SsoProviderType = 'saml' | 'oidc';

export interface SsoConnection {
  readonly id: string;
  readonly name: string;
  readonly providerType: SsoProviderType;
  readonly domains: string[];
  readonly jitEnabled: boolean;
  readonly deactivatedAt: string | null;
  readonly createdAt: string;
}

export interface Passkey {
  readonly id: string;
  readonly name?: string;
  readonly userId: string;
}

// ─── Phase 3 — User metadata & emails ─────────────────────────────────────

export interface UserMetadata {
  readonly publicMetadata: Record<string, unknown>;
}

export interface UserEmail {
  readonly id: string;
  readonly email: string;
  readonly verified: boolean;
  readonly primary: boolean;
  readonly createdAt: string;
}

export interface BrivenAuthClient {
  readonly projectId: string;
  readonly authUrl: string;
  readonly apiOrigin: string;
  readonly signIn: {
    email(input: SignInEmailInput): Promise<SignInResult>;
    magicLink(input: MagicLinkInput): Promise<MagicLinkResult>;
    otpRequest(input: MagicLinkInput): Promise<OtpRequestResult>;
    otpVerify(input: OtpVerifyInput): Promise<SignInResult>;
    /** Builds the OAuth start URL. Caller redirects the browser to it. */
    social(input: SocialInput): { redirectUrl: string };
    /** Exchange a single-use sign-in token for a session. */
    token(token: string): Promise<{ ok: true; expiresAt: string } | { ok: false; code: SignInErrorCode; message: string }>;
    /**
     * Sign in with username + password.
     * Resolves the username to an email internally, then uses the standard
     * email/password flow.
     */
    username(input: { username: string; password: string }): Promise<SignInResult>;
    /**
     * Exchange a testing token for a session.
     * Bypasses bot protection, rate limiting, and MFA.
     */
    testToken(token: string): Promise<{ ok: true; expiresAt: string } | { ok: false; code: SignInErrorCode; message: string }>;
  };
  readonly signUp: {
    email(input: SignUpEmailInput): Promise<SignInResult>;
  };
  sendPasswordReset(email: string): Promise<PasswordResetResult>;
  resetPassword(input: PasswordResetInput): Promise<PasswordResetResult>;
  readonly sessions: {
    list(): Promise<{ ok: true; sessions: ClientSession[] } | { ok: false; code: SignInErrorCode; message: string }>;
    revoke(sessionId: string): Promise<SimpleResult>;
  };
  readonly user: {
    update(input: UpdateUserInput): Promise<{ ok: true; user: User } | { ok: false; code: SignInErrorCode; message: string }>;
    changePassword(input: ChangePasswordInput): Promise<SimpleResult>;
    delete(): Promise<SimpleResult>;
    /** Get the current user's public metadata (frontend-safe). */
    getMetadata(): Promise<
      | { ok: true; publicMetadata: Record<string, unknown> }
      | { ok: false; code: SignInErrorCode; message: string }
    >;
    /** Set (merge) the current user's public metadata. */
    setMetadata(publicMetadata: Record<string, unknown>): Promise<
      | { ok: true; publicMetadata: Record<string, unknown> }
      | { ok: false; code: SignInErrorCode; message: string }
    >;
    /** List all additional emails for the current user. */
    listEmails(): Promise<
      | { ok: true; emails: UserEmail[] }
      | { ok: false; code: SignInErrorCode; message: string }
    >;
    /** Add an additional email address. */
    addEmail(email: string): Promise<
      | { ok: true; email: UserEmail }
      | { ok: false; code: SignInErrorCode; message: string }
    >;
    /** Remove an additional email address by id. */
    removeEmail(emailId: string): Promise<SimpleResult>;
    /**
     * Get a presigned URL to upload an avatar image directly to S3.
     * After uploading, call updateAvatar with the returned publicUrl.
     */
    getAvatarUploadUrl(contentType: string): Promise<
      | { ok: true; uploadUrl: string; publicUrl: string }
      | { ok: false; code: SignInErrorCode; message: string }
    >;
    /** Update the user's avatar image URL. Pass null to remove. */
    updateAvatar(imageUrl: string | null): Promise<SimpleResult>;
    /** Set or change the user's username. */
    setUsername(username: string): Promise<SimpleResult>;
    /** Get the user's username, or null if not set. */
    getUsername(): Promise<
      | { ok: true; username: string | null }
      | { ok: false; code: SignInErrorCode; message: string }
    >;
    /** Remove the user's username. */
    removeUsername(): Promise<SimpleResult>;
    /**
     * List all linked OAuth / SSO accounts for the current user.
     */
    listAccounts(): Promise<
      | { ok: true; accounts: Array<{ id: string; providerId: string; accountId: string; createdAt: string }> }
      | { ok: false; code: SignInErrorCode; message: string }
    >;
  };
  readonly organization: {
    create(input: { name: string; slug: string; logo?: string }): Promise<OrgResult<Org>>;
    list(): Promise<OrgResult<Org[]>>;
    get(orgId: string): Promise<OrgResult<Org>>;
    update(orgId: string, input: { name?: string; slug?: string; logo?: string | null }): Promise<OrgResult<Org>>;
    delete(orgId: string): Promise<SimpleResult>;
    listMembers(orgId: string): Promise<OrgResult<OrgMember[]>>;
    addMember(orgId: string, input: { userId: string; role?: 'admin' | 'member' }): Promise<OrgResult<OrgMember>>;
    updateMemberRole(orgId: string, userId: string, role: 'admin' | 'member'): Promise<OrgResult<OrgMember>>;
    removeMember(orgId: string, userId: string): Promise<SimpleResult>;
    listInvites(orgId: string): Promise<OrgResult<OrgInvite[]>>;
    createInvite(orgId: string, input: { email: string; role?: 'admin' | 'member' }): Promise<OrgResult<OrgInvite>>;
    revokeInvite(orgId: string, inviteId: string): Promise<SimpleResult>;
    acceptInvite(token: string): Promise<OrgResult<{ orgId: string }>>;
    getInvite(token: string): Promise<OrgResult<OrgInvite>>;
    // Phase 4 — Custom roles
    listRoles(orgId: string): Promise<OrgResult<OrgRole[]>>;
    createRole(orgId: string, input: { name: string; permissions: OrgPermission[] }): Promise<OrgResult<OrgRole>>;
    updateRole(orgId: string, roleId: string, input: { name?: string; permissions?: OrgPermission[] }): Promise<OrgResult<OrgRole>>;
    deleteRole(orgId: string, roleId: string): Promise<SimpleResult>;
    // Phase 4 — Domain verification
    listDomains(orgId: string): Promise<OrgResult<OrgDomain[]>>;
    addDomain(orgId: string, domain: string): Promise<OrgResult<OrgDomain>>;
    verifyDomain(orgId: string, domainId: string): Promise<OrgResult<OrgDomain>>;
    setDomainAutoJoin(orgId: string, domainId: string, enabled: boolean): Promise<OrgResult<OrgDomain>>;
    removeDomain(orgId: string, domainId: string): Promise<SimpleResult>;
    // Phase 4 — Membership requests
    createMembershipRequest(orgId: string, message?: string): Promise<OrgResult<MembershipRequest>>;
    listMembershipRequests(orgId: string, status?: 'pending' | 'approved' | 'rejected'): Promise<OrgResult<MembershipRequest[]>>;
    resolveMembershipRequest(orgId: string, requestId: string, decision: 'approved' | 'rejected'): Promise<OrgResult<MembershipRequest>>;
    // Phase 4 — Active organization
    setActive(orgId: string): Promise<SimpleResult>;
    getActive(): Promise<OrgResult<Org | null>>;
  };
  readonly sso: {
    /** List visible SSO connections (config stripped for security). */
    listConnections(): Promise<
      | { ok: true; connections: Array<Pick<SsoConnection, 'id' | 'name' | 'providerType' | 'domains'>> }
      | { ok: false; code: SignInErrorCode; message: string }
    >;
    /** Find an SSO connection by email domain. */
    getConnectionByDomain(domain: string): Promise<
      | { ok: true; connection: Pick<SsoConnection, 'id' | 'name' | 'providerType' | 'domains'> }
      | { ok: false; code: SignInErrorCode; message: string }
    >;
    /** Build the SAML/OIDC start URL. Caller redirects the browser to it. */
    start(connectionId: string, redirectTo?: string, providerType?: 'saml' | 'oidc'): { redirectUrl: string };
  };
  readonly twoFactor: {
    enable(password?: string): Promise<SimpleResult>;
    /** Complete MFA enroll or sign-in challenge with a TOTP app code. */
    verify(code: string): Promise<SignInResult>;
    disable(password?: string): Promise<SimpleResult>;
    /**
     * Mint a new set of single-use recovery codes (invalidates old ones).
     * Better Auth requires the account password unless passwordless backup
     * generation is enabled on the tenant.
     */
    generateBackupCodes(
      password?: string,
    ): Promise<{ ok: true; codes: string[] } | { ok: false; code: SignInErrorCode; message: string }>;
    /**
     * Sign in using a single-use backup/recovery code when the TOTP device
     * is lost. Consumes the code on success. This is the account-recovery
     * path that prevents permanent lockout.
     */
    verifyBackupCode(code: string): Promise<SignInResult>;
  };
  readonly passkey: {
    register(): Promise<SimpleResult>;
    list(): Promise<{ ok: true; passkeys: Passkey[] } | { ok: false; code: SignInErrorCode; message: string }>;
    signIn(): Promise<SignInResult>;
  };
  readonly impersonate: {
    /** Check if the current session is an impersonation session. */
    status(): Promise<
      | { ok: true; impersonating: true; impersonatedBy: string; targetUserId: string }
      | { ok: true; impersonating: false }
      | { ok: false; code: SignInErrorCode; message: string }
    >;
    /** Stop the current impersonation session. */
    stop(sessionToken: string): Promise<SimpleResult>;
  };
  readonly jwt: {
    /**
     * Generate a signed JWT for the current session.
     * Optionally pass a template name to include custom claims.
     */
    getToken(input?: { template?: string }): Promise<
      | { ok: true; token: string; expiresAt: string }
      | { ok: false; code: SignInErrorCode; message: string }
    >;
  };
  signOut(): Promise<{ ok: boolean }>;
  getSession(): Promise<SessionResponse>;
  getUser(): Promise<User | null>;
  /**
   * Build a hosted auth page URL for the given flow.
   * The customer's app redirects the browser to this URL so auth happens
   * same-origin on Briven's hosted pages, eliminating cross-origin/CORS
   * issues on localhost and custom domains.
   *
   * @param flow - which hosted page to open
   * @param callbackURL - where to send the user after successful auth
   * @param locale - optional BCP 47 locale override (e.g. 'nl', 'fr-FR')
   */
  hostedPageURL(
    flow: 'sign-in' | 'sign-up' | 'magic-link' | 'otp' | 'new-password' | 'profile',
    callbackURL?: string,
    locale?: string,
  ): string;
}

const DEFAULT_API_ORIGIN = 'https://api.briven.tech';
const BRIDGE_PREFIX = '/v1/auth-tenant';

/**
 * Construct the SDK client. Stateless — all auth state lives in the
 * browser cookie set by the api on successful sign-in. Re-creating the
 * client across renders is safe.
 */
export function createBrivenAuth(opts: CreateBrivenAuthOptions): BrivenAuthClient {
  if (!opts.projectId) throw new Error('@briven/auth: projectId is required');
  if (!opts.publicKey) throw new Error('@briven/auth: publicKey is required');
  const apiOrigin = opts.apiOrigin ?? DEFAULT_API_ORIGIN;
  const authUrl = opts.authUrl ?? `https://${opts.projectId}.auth.briven.tech`;
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);

  async function post<T>(path: string, body: Record<string, unknown> | null): Promise<T> {
    const res = await fetchImpl(`${apiOrigin}${BRIDGE_PREFIX}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-briven-project-id': opts.projectId,
        authorization: `Bearer ${opts.publicKey}`,
      },
      body: body === null ? undefined : JSON.stringify(body),
    });
    return (await res.json()) as T;
  }

  async function get<T>(path: string): Promise<T> {
    const res = await fetchImpl(`${apiOrigin}${BRIDGE_PREFIX}${path}`, {
      credentials: 'include',
      headers: {
        'x-briven-project-id': opts.projectId,
        authorization: `Bearer ${opts.publicKey}`,
      },
    });
    return (await res.json()) as T;
  }

  async function patch<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetchImpl(`${apiOrigin}${BRIDGE_PREFIX}${path}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-briven-project-id': opts.projectId,
        authorization: `Bearer ${opts.publicKey}`,
      },
      body: JSON.stringify(body),
    });
    return (await res.json()) as T;
  }

  function asSignInResult(body: unknown): SignInResult {
    if (body && typeof body === 'object') {
      const b = body as {
        user?: { id?: string };
        token?: string;
        expiresAt?: string;
        session?: { expiresAt?: string };
        twoFactorRedirect?: boolean;
        error?: { code?: string; message?: string };
        code?: string;
        message?: string;
      };
      // Better Auth signals "password ok, now finish 2FA" this way.
      if (b.twoFactorRedirect === true) {
        return { ok: true, twoFactorRequired: true };
      }
      if (b.user?.id) {
        const expiresAt =
          b.expiresAt ??
          b.session?.expiresAt ??
          new Date(Date.now() + 7 * 86_400_000).toISOString();
        return { ok: true, userId: b.user.id, sessionExpiresAt: expiresAt };
      }
      const code = (b.error?.code ?? b.code ?? 'unknown') as SignInErrorCode;
      const message = b.error?.message ?? b.message ?? 'sign-in failed';
      return { ok: false, code: knownCode(code), message };
    }
    return { ok: false, code: 'unknown', message: 'sign-in failed' };
  }

  function asSimpleResult(body: unknown): SimpleResult {
    if (body && typeof body === 'object') {
      const b = body as {
        status?: boolean;
        error?: { code?: string; message?: string };
        code?: string;
        message?: string;
      };
      if (b.status === true) {
        return { ok: true };
      }
      const code = (b.error?.code ?? b.code ?? 'unknown') as SignInErrorCode;
      const message = b.error?.message ?? b.message ?? 'request failed';
      return { ok: false, code: knownCode(code), message };
    }
    return { ok: false, code: 'unknown', message: 'request failed' };
  }

  return {
    projectId: opts.projectId,
    authUrl,
    apiOrigin,
    signIn: {
      async email(input) {
        try {
          const body = await post<unknown>('/sign-in/email', input as unknown as Record<string, unknown>);
          return asSignInResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async magicLink(input) {
        try {
          await post<unknown>('/sign-in/magic-link', input as unknown as Record<string, unknown>);
          return { ok: true };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async otpRequest(input) {
        try {
          await post<unknown>('/sign-in/email-otp/send-verification-otp', input as unknown as Record<string, unknown>);
          return { ok: true };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async otpVerify(input) {
        try {
          const body = await post<unknown>('/sign-in/email-otp/verify', input as unknown as Record<string, unknown>);
          return asSignInResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      social(input) {
        const u = new URL(`${apiOrigin}${BRIDGE_PREFIX}/sign-in/social`);
        u.searchParams.set('provider', input.provider);
        u.searchParams.set('callbackURL', input.redirectTo ?? authUrl);
        u.searchParams.set('projectId', opts.projectId);
        return { redirectUrl: u.toString() };
      },
      async token(token) {
        try {
          const body = await post<unknown>('/sign-in/token', { token });
          if (body && typeof body === 'object') {
            const b = body as { ok?: boolean; expiresAt?: string; error?: { code?: string; message?: string }; code?: string; message?: string };
            if (b.ok === true && b.expiresAt) {
              return { ok: true as const, expiresAt: b.expiresAt };
            }
            const code = (b.error?.code ?? b.code ?? 'unknown') as SignInErrorCode;
            const message = b.error?.message ?? b.message ?? 'token exchange failed';
            return { ok: false as const, code: knownCode(code), message };
          }
          return { ok: false as const, code: 'unknown' as const, message: 'token exchange failed' };
        } catch {
          return { ok: false as const, code: 'network_error' as const, message: 'network error' };
        }
      },
      async username(input) {
        try {
          const body = await post<unknown>('/username/sign-in', input);
          return asSignInResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async testToken(token) {
        try {
          const body = await post<unknown>('/test-token', { token });
          if (body && typeof body === 'object') {
            const b = body as { ok?: boolean; expiresAt?: string; code?: string; message?: string };
            if (b.ok === true && b.expiresAt) {
              return { ok: true as const, expiresAt: b.expiresAt };
            }
            return { ok: false as const, code: knownCode(b.code ?? 'unknown'), message: b.message ?? 'exchange failed' };
          }
          return { ok: false as const, code: 'unknown' as const, message: 'exchange failed' };
        } catch {
          return { ok: false as const, code: 'network_error' as const, message: 'network error' };
        }
      },
    },
    signUp: {
      async email(input) {
        try {
          const body = await post<unknown>('/sign-up/email', input as unknown as Record<string, unknown>);
          return asSignInResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
    },
    async sendPasswordReset(email) {
      try {
        const body = await post<unknown>('/request-password-reset', { email });
        return asSimpleResult(body);
      } catch {
        return { ok: false, code: 'network_error', message: 'network error' };
      }
    },
    async resetPassword(input) {
      try {
        const body = await post<unknown>('/reset-password', input as unknown as Record<string, unknown>);
        return asSimpleResult(body);
      } catch {
        return { ok: false, code: 'network_error', message: 'network error' };
      }
    },
    sessions: {
      async list() {
        try {
          const body = await get<unknown>('/list-sessions');
          if (body && typeof body === 'object') {
            const b = body as { sessions?: ClientSession[]; error?: { code?: string; message?: string } };
            if (Array.isArray(b.sessions)) {
              return { ok: true, sessions: b.sessions };
            }
            return {
              ok: false,
              code: knownCode(b.error?.code ?? 'unknown'),
              message: b.error?.message ?? 'failed to list sessions',
            };
          }
          return { ok: false, code: 'unknown', message: 'failed to list sessions' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async revoke(sessionId) {
        try {
          const body = await post<unknown>('/revoke-session', { sessionId });
          return asSimpleResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
    },
    user: {
      async update(input) {
        try {
          const body = await patch<unknown>('/update-user', input as unknown as Record<string, unknown>);
          if (body && typeof body === 'object') {
            const b = body as { user?: User; error?: { code?: string; message?: string } };
            if (b.user) return { ok: true, user: b.user };
            return {
              ok: false,
              code: knownCode(b.error?.code ?? 'unknown'),
              message: b.error?.message ?? 'update failed',
            };
          }
          return { ok: false, code: 'unknown', message: 'update failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async changePassword(input) {
        try {
          const body = await post<unknown>('/change-password', input as unknown as Record<string, unknown>);
          return asSimpleResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async delete() {
        try {
          const body = await post<unknown>('/delete-user', {});
          return asSimpleResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async getMetadata() {
        try {
          const body = await get<unknown>('/user/metadata');
          if (body && typeof body === 'object') {
            const b = body as { publicMetadata?: Record<string, unknown>; error?: { code?: string; message?: string } };
            if (b.publicMetadata !== undefined) {
              return { ok: true as const, publicMetadata: b.publicMetadata };
            }
            return {
              ok: false as const,
              code: knownCode(b.error?.code ?? 'unknown'),
              message: b.error?.message ?? 'failed to get metadata',
            };
          }
          return { ok: false as const, code: 'unknown' as const, message: 'failed to get metadata' };
        } catch {
          return { ok: false as const, code: 'network_error' as const, message: 'network error' };
        }
      },
      async setMetadata(publicMetadata) {
        try {
          const body = await patch<unknown>('/user/metadata', { publicMetadata });
          if (body && typeof body === 'object') {
            const b = body as { publicMetadata?: Record<string, unknown>; error?: { code?: string; message?: string } };
            if (b.publicMetadata !== undefined) {
              return { ok: true as const, publicMetadata: b.publicMetadata };
            }
            return {
              ok: false as const,
              code: knownCode(b.error?.code ?? 'unknown'),
              message: b.error?.message ?? 'failed to set metadata',
            };
          }
          return { ok: false as const, code: 'unknown' as const, message: 'failed to set metadata' };
        } catch {
          return { ok: false as const, code: 'network_error' as const, message: 'network error' };
        }
      },
      async listEmails() {
        try {
          const body = await get<unknown>('/user/emails');
          if (body && typeof body === 'object') {
            const b = body as { emails?: UserEmail[]; error?: { code?: string; message?: string } };
            if (Array.isArray(b.emails)) {
              return { ok: true as const, emails: b.emails };
            }
            return {
              ok: false as const,
              code: knownCode(b.error?.code ?? 'unknown'),
              message: b.error?.message ?? 'failed to list emails',
            };
          }
          return { ok: false as const, code: 'unknown' as const, message: 'failed to list emails' };
        } catch {
          return { ok: false as const, code: 'network_error' as const, message: 'network error' };
        }
      },
      async addEmail(email) {
        try {
          const body = await post<unknown>('/user/emails', { email });
          if (body && typeof body === 'object') {
            const b = body as { email?: UserEmail; error?: { code?: string; message?: string } };
            if (b.email) {
              return { ok: true as const, email: b.email };
            }
            return {
              ok: false as const,
              code: knownCode(b.error?.code ?? 'unknown'),
              message: b.error?.message ?? 'failed to add email',
            };
          }
          return { ok: false as const, code: 'unknown' as const, message: 'failed to add email' };
        } catch {
          return { ok: false as const, code: 'network_error' as const, message: 'network error' };
        }
      },
      async removeEmail(emailId) {
        try {
          const res = await fetchImpl(`${apiOrigin}${BRIDGE_PREFIX}/user/emails/${emailId}`, {
            method: 'DELETE',
            credentials: 'include',
            headers: {
              'x-briven-project-id': opts.projectId,
              authorization: `Bearer ${opts.publicKey}`,
            },
          });
          const body = (await res.json()) as unknown;
          return asSimpleResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async getAvatarUploadUrl(contentType) {
        try {
          const body = await post<unknown>('/user/avatar/presign', { contentType });
          if (body && typeof body === 'object') {
            const b = body as { uploadUrl?: string; publicUrl?: string; code?: string; message?: string };
            if (typeof b.uploadUrl === 'string' && typeof b.publicUrl === 'string') {
              return { ok: true as const, uploadUrl: b.uploadUrl, publicUrl: b.publicUrl };
            }
            if (b.code) {
              return { ok: false as const, code: knownCode(b.code), message: b.message ?? 'presign failed' };
            }
          }
          return { ok: false as const, code: 'unknown' as const, message: 'presign failed' };
        } catch {
          return { ok: false as const, code: 'network_error' as const, message: 'network error' };
        }
      },
      async updateAvatar(imageUrl) {
        try {
          const body = await post<unknown>('/user/avatar', { imageUrl });
          return asSimpleResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async setUsername(username) {
        try {
          const body = await post<unknown>('/username', { username });
          return asSimpleResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async getUsername() {
        try {
          const body = await get<unknown>('/username');
          if (body && typeof body === 'object') {
            const b = body as { username?: string | null; code?: string; message?: string };
            if ('username' in b) {
              return { ok: true as const, username: b.username ?? null };
            }
            if (b.code) {
              return { ok: false as const, code: knownCode(b.code), message: b.message ?? 'failed' };
            }
          }
          return { ok: false as const, code: 'unknown' as const, message: 'failed' };
        } catch {
          return { ok: false as const, code: 'network_error' as const, message: 'network error' };
        }
      },
      async removeUsername() {
        try {
          const res = await fetchImpl(`${apiOrigin}${BRIDGE_PREFIX}/username`, {
            method: 'DELETE',
            credentials: 'include',
            headers: {
              'x-briven-project-id': opts.projectId,
              authorization: `Bearer ${opts.publicKey}`,
            },
          });
          const body = (await res.json()) as unknown;
          return asSimpleResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async listAccounts() {
        try {
          const body = await get<unknown>('/user/accounts');
          if (body && typeof body === 'object') {
            const b = body as {
              accounts?: Array<{ id: string; providerId: string; accountId: string; createdAt: string }>;
              code?: string;
              message?: string;
            };
            if (Array.isArray(b.accounts)) {
              return { ok: true as const, accounts: b.accounts };
            }
            if (b.code) {
              return { ok: false as const, code: knownCode(b.code), message: b.message ?? 'failed' };
            }
          }
          return { ok: false as const, code: 'unknown' as const, message: 'failed' };
        } catch {
          return { ok: false as const, code: 'network_error' as const, message: 'network error' };
        }
      },
    },
    organization: {
      async create(input) {
        try {
          const body = await post<unknown>('/orgs', input as unknown as Record<string, unknown>);
          if (body && typeof body === 'object') {
            const b = body as { org?: Org; error?: { code?: string; message?: string } };
            if (b.org) return { ok: true, data: b.org };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'create failed' };
          }
          return { ok: false, code: 'unknown', message: 'create failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async list() {
        try {
          const body = await get<unknown>('/orgs');
          if (body && typeof body === 'object') {
            const b = body as { orgs?: Org[]; error?: { code?: string; message?: string } };
            if (Array.isArray(b.orgs)) return { ok: true, data: b.orgs };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'list failed' };
          }
          return { ok: false, code: 'unknown', message: 'list failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async get(orgId) {
        try {
          const body = await get<unknown>(`/orgs/${orgId}`);
          if (body && typeof body === 'object') {
            const b = body as { org?: Org; error?: { code?: string; message?: string } };
            if (b.org) return { ok: true, data: b.org };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'get failed' };
          }
          return { ok: false, code: 'unknown', message: 'get failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async update(orgId, input) {
        try {
          const body = await patch<unknown>(`/orgs/${orgId}`, input as unknown as Record<string, unknown>);
          if (body && typeof body === 'object') {
            const b = body as { org?: Org; error?: { code?: string; message?: string } };
            if (b.org) return { ok: true, data: b.org };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'update failed' };
          }
          return { ok: false, code: 'unknown', message: 'update failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async delete(orgId) {
        try {
          const body = await post<unknown>(`/orgs/${orgId}/delete`, {});
          return asSimpleResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async listMembers(orgId) {
        try {
          const body = await get<unknown>(`/orgs/${orgId}/members`);
          if (body && typeof body === 'object') {
            const b = body as { members?: OrgMember[]; error?: { code?: string; message?: string } };
            if (Array.isArray(b.members)) return { ok: true, data: b.members };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'list failed' };
          }
          return { ok: false, code: 'unknown', message: 'list failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async addMember(orgId, input) {
        try {
          const body = await post<unknown>(`/orgs/${orgId}/members`, input as unknown as Record<string, unknown>);
          if (body && typeof body === 'object') {
            const b = body as { member?: OrgMember; error?: { code?: string; message?: string } };
            if (b.member) return { ok: true, data: b.member };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'add failed' };
          }
          return { ok: false, code: 'unknown', message: 'add failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async updateMemberRole(orgId, userId, role) {
        try {
          const body = await patch<unknown>(`/orgs/${orgId}/members/${userId}`, { role });
          if (body && typeof body === 'object') {
            const b = body as { member?: OrgMember; error?: { code?: string; message?: string } };
            if (b.member) return { ok: true, data: b.member };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'update failed' };
          }
          return { ok: false, code: 'unknown', message: 'update failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async removeMember(orgId, userId) {
        try {
          const body = await post<unknown>(`/orgs/${orgId}/members/${userId}/delete`, {});
          return asSimpleResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async listInvites(orgId) {
        try {
          const body = await get<unknown>(`/orgs/${orgId}/invites`);
          if (body && typeof body === 'object') {
            const b = body as { invites?: OrgInvite[]; error?: { code?: string; message?: string } };
            if (Array.isArray(b.invites)) return { ok: true, data: b.invites };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'list failed' };
          }
          return { ok: false, code: 'unknown', message: 'list failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async createInvite(orgId, input) {
        try {
          const body = await post<unknown>(`/orgs/${orgId}/invites`, input as unknown as Record<string, unknown>);
          if (body && typeof body === 'object') {
            const b = body as { invite?: OrgInvite; error?: { code?: string; message?: string } };
            if (b.invite) return { ok: true, data: b.invite };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'create failed' };
          }
          return { ok: false, code: 'unknown', message: 'create failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async revokeInvite(orgId, inviteId) {
        try {
          const body = await post<unknown>(`/orgs/${orgId}/invites/${inviteId}/delete`, {});
          return asSimpleResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async acceptInvite(token) {
        try {
          const body = await post<unknown>('/invites/accept', { token });
          if (body && typeof body === 'object') {
            const b = body as { orgId?: string; error?: { code?: string; message?: string } };
            if (b.orgId) return { ok: true, data: { orgId: b.orgId } };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'accept failed' };
          }
          return { ok: false, code: 'unknown', message: 'accept failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async getInvite(token) {
        try {
          const body = await get<unknown>(`/invites/${token}`);
          if (body && typeof body === 'object') {
            const b = body as { invite?: OrgInvite; error?: { code?: string; message?: string } };
            if (b.invite) return { ok: true, data: b.invite };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'get failed' };
          }
          return { ok: false, code: 'unknown', message: 'get failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      // Phase 4 — Custom roles
      async listRoles(orgId) {
        try {
          const body = await get<unknown>(`/orgs/${orgId}/roles`);
          if (body && typeof body === 'object') {
            const b = body as { roles?: OrgRole[]; error?: { code?: string; message?: string } };
            if (Array.isArray(b.roles)) return { ok: true, data: b.roles };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'list failed' };
          }
          return { ok: false, code: 'unknown', message: 'list failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async createRole(orgId, input) {
        try {
          const body = await post<unknown>(`/orgs/${orgId}/roles`, input as unknown as Record<string, unknown>);
          if (body && typeof body === 'object') {
            const b = body as { role?: OrgRole; error?: { code?: string; message?: string } };
            if (b.role) return { ok: true, data: b.role };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'create failed' };
          }
          return { ok: false, code: 'unknown', message: 'create failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async updateRole(orgId, roleId, input) {
        try {
          const body = await patch<unknown>(`/orgs/${orgId}/roles/${roleId}`, input as unknown as Record<string, unknown>);
          if (body && typeof body === 'object') {
            const b = body as { role?: OrgRole; error?: { code?: string; message?: string } };
            if (b.role) return { ok: true, data: b.role };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'update failed' };
          }
          return { ok: false, code: 'unknown', message: 'update failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async deleteRole(orgId, roleId) {
        try {
          const body = await post<unknown>(`/orgs/${orgId}/roles/${roleId}/delete`, {});
          return asSimpleResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      // Phase 4 — Domain verification
      async listDomains(orgId) {
        try {
          const body = await get<unknown>(`/orgs/${orgId}/domains`);
          if (body && typeof body === 'object') {
            const b = body as { domains?: OrgDomain[]; error?: { code?: string; message?: string } };
            if (Array.isArray(b.domains)) return { ok: true, data: b.domains };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'list failed' };
          }
          return { ok: false, code: 'unknown', message: 'list failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async addDomain(orgId, domain) {
        try {
          const body = await post<unknown>(`/orgs/${orgId}/domains`, { domain });
          if (body && typeof body === 'object') {
            const b = body as { domain?: OrgDomain; error?: { code?: string; message?: string } };
            if (b.domain) return { ok: true, data: b.domain };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'add failed' };
          }
          return { ok: false, code: 'unknown', message: 'add failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async verifyDomain(orgId, domainId) {
        try {
          const body = await post<unknown>(`/orgs/${orgId}/domains/${domainId}/verify`, {});
          if (body && typeof body === 'object') {
            const b = body as { domain?: OrgDomain; error?: { code?: string; message?: string } };
            if (b.domain) return { ok: true, data: b.domain };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'verify failed' };
          }
          return { ok: false, code: 'unknown', message: 'verify failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async setDomainAutoJoin(orgId, domainId, enabled) {
        try {
          const body = await patch<unknown>(`/orgs/${orgId}/domains/${domainId}/auto-join`, { enabled });
          if (body && typeof body === 'object') {
            const b = body as { domain?: OrgDomain; error?: { code?: string; message?: string } };
            if (b.domain) return { ok: true, data: b.domain };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'update failed' };
          }
          return { ok: false, code: 'unknown', message: 'update failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async removeDomain(orgId, domainId) {
        try {
          const body = await post<unknown>(`/orgs/${orgId}/domains/${domainId}/delete`, {});
          return asSimpleResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      // Phase 4 — Membership requests
      async createMembershipRequest(orgId, message) {
        try {
          const body = await post<unknown>(`/orgs/${orgId}/membership-requests`, message ? { message } : {});
          if (body && typeof body === 'object') {
            const b = body as { request?: MembershipRequest; error?: { code?: string; message?: string } };
            if (b.request) return { ok: true, data: b.request };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'create failed' };
          }
          return { ok: false, code: 'unknown', message: 'create failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async listMembershipRequests(orgId, status) {
        try {
          const qs = status ? `?status=${status}` : '';
          const body = await get<unknown>(`/orgs/${orgId}/membership-requests${qs}`);
          if (body && typeof body === 'object') {
            const b = body as { requests?: MembershipRequest[]; error?: { code?: string; message?: string } };
            if (Array.isArray(b.requests)) return { ok: true, data: b.requests };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'list failed' };
          }
          return { ok: false, code: 'unknown', message: 'list failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async resolveMembershipRequest(orgId, requestId, decision) {
        try {
          const body = await post<unknown>(`/orgs/${orgId}/membership-requests/${requestId}/resolve`, { decision });
          if (body && typeof body === 'object') {
            const b = body as { request?: MembershipRequest; error?: { code?: string; message?: string } };
            if (b.request) return { ok: true, data: b.request };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'resolve failed' };
          }
          return { ok: false, code: 'unknown', message: 'resolve failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      // Phase 4 — Active organization
      async setActive(orgId) {
        try {
          const body = await post<unknown>(`/orgs/${orgId}/set-active`, {});
          return asSimpleResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async getActive() {
        try {
          const body = await get<unknown>('/orgs/active');
          if (body && typeof body === 'object') {
            const b = body as { activeOrg?: Org | null; error?: { code?: string; message?: string } };
            return { ok: true, data: b.activeOrg ?? null };
          }
          return { ok: false, code: 'unknown', message: 'get failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
    },
    sso: {
      async listConnections() {
        try {
          const body = await get<unknown>('/sso/connections');
          if (body && typeof body === 'object') {
            const b = body as { connections?: Array<Pick<SsoConnection, 'id' | 'name' | 'providerType' | 'domains'>>; error?: { code?: string; message?: string } };
            if (Array.isArray(b.connections)) return { ok: true, connections: b.connections };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'list failed' };
          }
          return { ok: false, code: 'unknown', message: 'list failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async getConnectionByDomain(domain) {
        try {
          const body = await get<unknown>(`/sso/domain/${encodeURIComponent(domain)}`);
          if (body && typeof body === 'object') {
            const b = body as { connection?: Pick<SsoConnection, 'id' | 'name' | 'providerType' | 'domains'>; error?: { code?: string; message?: string } };
            if (b.connection) return { ok: true, connection: b.connection };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'get failed' };
          }
          return { ok: false, code: 'unknown', message: 'get failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      start(connectionId, redirectTo, providerType = 'saml') {
        const path = providerType === 'oidc' ? `/sso/oidc/${connectionId}` : `/sso/saml/${connectionId}`;
        const u = new URL(`${apiOrigin}${BRIDGE_PREFIX}${path}`);
        if (redirectTo) u.searchParams.set('redirectTo', redirectTo);
        return { redirectUrl: u.toString() };
      },
    },
    twoFactor: {
      async enable(password) {
        try {
          const body = await post<unknown>('/two-factor/enable', password ? { password } : {});
          return asSimpleResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async verify(code) {
        try {
          // Better Auth endpoint is verify-totp (not /two-factor/verify).
          const body = await post<unknown>('/two-factor/verify-totp', { code });
          return asSignInResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async disable(password) {
        try {
          const body = await post<unknown>('/two-factor/disable', password ? { password } : {});
          return asSimpleResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async generateBackupCodes(password) {
        try {
          const body = await post<unknown>(
            '/two-factor/generate-backup-codes',
            password ? { password } : {},
          );
          if (body && typeof body === 'object') {
            const b = body as { backupCodes?: string[]; error?: { code?: string; message?: string } };
            if (Array.isArray(b.backupCodes)) return { ok: true, codes: b.backupCodes };
            return {
              ok: false,
              code: knownCode(b.error?.code ?? 'unknown'),
              message: b.error?.message ?? 'generate failed',
            };
          }
          return { ok: false, code: 'unknown', message: 'generate failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async verifyBackupCode(code) {
        try {
          const body = await post<unknown>('/two-factor/verify-backup-code', { code });
          return asSignInResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
    },
    passkey: {
      async register() {
        try {
          const body = await post<unknown>('/passkey/register', {});
          return asSimpleResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async list() {
        try {
          const body = await get<unknown>('/passkey/list-passkeys');
          if (body && typeof body === 'object') {
            const b = body as { passkeys?: Passkey[]; error?: { code?: string; message?: string } };
            if (Array.isArray(b.passkeys)) return { ok: true, passkeys: b.passkeys };
            return { ok: false, code: knownCode(b.error?.code ?? 'unknown'), message: b.error?.message ?? 'list failed' };
          }
          return { ok: false, code: 'unknown', message: 'list failed' };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async signIn() {
        try {
          const body = await post<unknown>('/passkey/authenticate', {});
          return asSignInResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
    },
    impersonate: {
      async status() {
        try {
          const body = await get<unknown>('/impersonation');
          if (body && typeof body === 'object') {
            const b = body as {
              impersonating?: boolean;
              impersonatedBy?: string;
              targetUserId?: string;
              error?: { code?: string; message?: string };
            };
            if (b.impersonating === true && b.impersonatedBy && b.targetUserId) {
              return {
                ok: true as const,
                impersonating: true as const,
                impersonatedBy: b.impersonatedBy,
                targetUserId: b.targetUserId,
              };
            }
            if (b.impersonating === false) {
              return { ok: true as const, impersonating: false as const };
            }
            return {
              ok: false as const,
              code: knownCode(b.error?.code ?? 'unknown'),
              message: b.error?.message ?? 'status check failed',
            };
          }
          return { ok: true as const, impersonating: false as const };
        } catch {
          return { ok: false as const, code: 'network_error' as const, message: 'network error' };
        }
      },
      async stop(sessionToken) {
        try {
          const body = await post<unknown>('/impersonation/stop', { sessionToken });
          return asSimpleResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
    },
    jwt: {
      async getToken(input = {}) {
        try {
          const body = await post<unknown>('/jwt/token', { template: input.template });
          if (body && typeof body === 'object') {
            const b = body as { token?: string; expiresAt?: string; code?: string; message?: string };
            if (typeof b.token === 'string' && typeof b.expiresAt === 'string') {
              return { ok: true as const, token: b.token, expiresAt: b.expiresAt };
            }
            if (b.code) {
              return { ok: false as const, code: knownCode(b.code), message: b.message ?? 'token generation failed' };
            }
          }
          return { ok: false as const, code: 'unknown' as const, message: 'token generation failed' };
        } catch {
          return { ok: false as const, code: 'network_error' as const, message: 'network error' };
        }
      },
    },
    async signOut() {
      try {
        await post<unknown>('/sign-out', null);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },
    async getSession() {
      try {
        const body = await get<unknown>('/get-session');
        if (body && typeof body === 'object') {
          const b = body as {
            user?: { id?: string };
            session?: { expiresAt?: string };
          };
          if (b.user?.id && b.session?.expiresAt) {
            return {
              authenticated: true,
              userId: b.user.id,
              expiresAt: b.session.expiresAt,
            };
          }
        }
        return { authenticated: false };
      } catch {
        return { authenticated: false };
      }
    },
    async getUser() {
      try {
        const body = await get<unknown>('/get-session');
        if (body && typeof body === 'object') {
          const b = body as { user?: User };
          return b.user ?? null;
        }
        return null;
      } catch {
        return null;
      }
    },
    hostedPageURL(flow, callbackURL, locale) {
      const u = new URL(`https://${opts.projectId}.auth.briven.tech`);
      u.pathname = `/${flow}`;
      if (callbackURL) {
        u.searchParams.set('callbackURL', callbackURL);
      }
      if (locale) {
        u.searchParams.set('locale', locale);
      }
      return u.toString();
    },
  };
}

const KNOWN_CODES: ReadonlySet<SignInErrorCode> = new Set<SignInErrorCode>([
  'invalid_credentials',
  'email_taken',
  'weak_password',
  'rate_limited',
  'unverified_email',
  'tenant_unresolved',
  'network_error',
  'unknown',
]);

function knownCode(value: string): SignInErrorCode {
  return KNOWN_CODES.has(value as SignInErrorCode) ? (value as SignInErrorCode) : 'unknown';
}

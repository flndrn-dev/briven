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
   */
  hostedPageURL(
    flow: 'sign-in' | 'sign-up' | 'magic-link' | 'otp' | 'new-password' | 'profile',
    callbackURL?: string,
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
        error?: { code?: string; message?: string };
        code?: string;
        message?: string;
      };
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
    hostedPageURL(flow, callbackURL) {
      const u = new URL(`https://${opts.projectId}.auth.briven.tech`);
      u.pathname = `/${flow}`;
      if (callbackURL) {
        u.searchParams.set('callbackURL', callbackURL);
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

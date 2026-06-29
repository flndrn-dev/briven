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

/** Built-in social providers Briven wires natively. */
export type OAuthProvider = 'google' | 'github' | 'discord' | 'microsoft' | 'konnos';

/**
 * A provider the customer can sign in with: a built-in {@link OAuthProvider} OR
 * a custom-OIDC slug the project configured (any `[a-z0-9-]` id). The `string &
 * {}` keeps editor autocomplete for the built-ins while still accepting slugs.
 */
export type SocialProvider = OAuthProvider | (string & {});

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

export type MagicLinkResult =
  | { ok: true }
  | { ok: false; code: SignInErrorCode; message: string };

export type OtpRequestResult = MagicLinkResult;

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

export interface ResetPasswordInput {
  /** The reset token from the email link (`?token=…`). */
  token: string;
  /** The new password to apply. */
  newPassword: string;
}

/** Returned by `sendPasswordReset` and `resetPassword`. */
export type PasswordResetResult =
  | { ok: true }
  | { ok: false; code: SignInErrorCode; message: string };

export interface SocialInput {
  provider: SocialProvider;
  /** Optional URL the customer's app wants the user to land on post-callback. */
  redirectTo?: string;
}

export interface BrivenAuthClient {
  readonly projectId: string;
  readonly authUrl: string;
  readonly apiOrigin: string;
  /**
   * SDK public key. Exposed so server-side helpers (`@briven/auth/server`)
   * can forward `authorization: Bearer <publicKey>` — the same header the
   * browser get()/post() calls send — when validating a session off the
   * incoming cookie. Without it the api can't resolve the tenant and the
   * server session is always null.
   */
  readonly publicKey: string;
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
  signOut(): Promise<{ ok: boolean }>;
  getSession(): Promise<SessionResponse>;
  getUser(): Promise<User | null>;
  /**
   * Discover which OAuth/OIDC providers are actually wired for this project,
   * from the PUBLIC, unauthenticated branding/config endpoint. Returns the
   * provider keys + custom-OIDC slugs that are fully configured (enabled +
   * client id + stored secret). Used by `<BrivenSignIn>` to render only the
   * live buttons when no explicit `providers` prop is given. Never throws —
   * returns `[]` on any error (e.g. CORS / network), so callers can fall back.
   */
  getEnabledProviders(): Promise<string[]>;
  /**
   * Send a password-reset email to the supplied address.
   * POST /request-password-reset — Better Auth always returns ok to prevent
   * user enumeration; `{ ok: true }` does NOT confirm the email exists.
   */
  sendPasswordReset(email: string): Promise<PasswordResetResult>;
  /**
   * Complete a password reset using the token from the email link.
   * POST /reset-password — pass the `?token=` query param value here.
   */
  resetPassword(input: ResetPasswordInput): Promise<PasswordResetResult>;
  /**
   * Passkey (WebAuthn) helpers — drive the `@better-auth/passkey@1.6.9` plugin
   * the Briven API wires per-tenant when `providers.passkey.enabled`.
   *
   * Each method runs the real two-step ceremony against the plugin's verified
   * endpoint ids (confirmed from the installed dist):
   *   register:  GET  /passkey/generate-register-options      (needs a session)
   *              → navigator.credentials.create()
   *              → POST /passkey/verify-registration   body { response }
   *   signIn:    GET  /passkey/generate-authenticate-options
   *              → navigator.credentials.get()
   *              → POST /passkey/verify-authentication body { response }
   *
   * The server returns options in @simplewebauthn JSON form (challenge / ids
   * are base64url strings); we decode them for the WebAuthn call and re-encode
   * the credential as base64url (no padding) before posting it back wrapped in
   * `{ response }`. registration MUST include `response.transports` (the plugin
   * joins it unconditionally).
   */
  readonly passkey: {
    /** Register a new passkey for the currently-signed-in user. */
    register(): Promise<PasswordResetResult>;
    /** Sign in via an existing passkey (no password needed). */
    signIn(): Promise<SignInResult>;
  };
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

  // Raw variants expose the Response so the passkey ceremony can branch on
  // status (404/501 → plugin not enabled). The typed get/post wrap them.
  function rawPost(path: string, body: Record<string, unknown> | null): Promise<Response> {
    return fetchImpl(`${apiOrigin}${BRIDGE_PREFIX}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-briven-project-id': opts.projectId,
        authorization: `Bearer ${opts.publicKey}`,
      },
      body: body === null ? undefined : JSON.stringify(body),
    });
  }

  function rawGet(path: string): Promise<Response> {
    return fetchImpl(`${apiOrigin}${BRIDGE_PREFIX}${path}`, {
      credentials: 'include',
      headers: {
        'x-briven-project-id': opts.projectId,
        authorization: `Bearer ${opts.publicKey}`,
      },
    });
  }

  async function post<T>(path: string, body: Record<string, unknown> | null): Promise<T> {
    return (await (await rawPost(path, body)).json()) as T;
  }

  async function get<T>(path: string): Promise<T> {
    return (await (await rawGet(path)).json()) as T;
  }

  function asSignInResult(body: unknown): SignInResult {
    // Better Auth's success shape is `{ user, token, ... }`. Normalise to
    // briven's documented response — we never expose Better Auth shapes
    // to the customer's app code.
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

  return {
    projectId: opts.projectId,
    authUrl,
    apiOrigin,
    publicKey: opts.publicKey,
    signIn: {
      async email(input) {
        try {
          const body = await post<unknown>(
            '/sign-in/email',
            input as unknown as Record<string, unknown>,
          );
          return asSignInResult(body);
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async magicLink(input) {
        try {
          await post<unknown>(
            '/sign-in/magic-link',
            input as unknown as Record<string, unknown>,
          );
          return { ok: true };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async otpRequest(input) {
        try {
          await post<unknown>(
            '/sign-in/email-otp/send-verification-otp',
            input as unknown as Record<string, unknown>,
          );
          return { ok: true };
        } catch {
          return { ok: false, code: 'network_error', message: 'network error' };
        }
      },
      async otpVerify(input) {
        try {
          const body = await post<unknown>(
            '/sign-in/email-otp/verify',
            input as unknown as Record<string, unknown>,
          );
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
          const body = await post<unknown>(
            '/sign-up/email',
            input as unknown as Record<string, unknown>,
          );
          return asSignInResult(body);
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
    async getEnabledProviders() {
      // The PUBLIC branding/config endpoint is NOT under the auth-tenant bridge
      // prefix and needs no session/key — fetch it directly off the api origin.
      try {
        const res = await fetchImpl(
          `${apiOrigin}/v1/projects/${opts.projectId}/auth/branding/config`,
          { credentials: 'omit' },
        );
        if (!res.ok) return [];
        const body = (await res.json()) as { socialProviders?: unknown };
        return Array.isArray(body.socialProviders)
          ? body.socialProviders.filter((p): p is string => typeof p === 'string')
          : [];
      } catch {
        return [];
      }
    },
    async sendPasswordReset(email: string) {
      try {
        await post<unknown>('/request-password-reset', { email });
        return { ok: true as const };
      } catch {
        return { ok: false as const, code: 'network_error' as SignInErrorCode, message: 'network error' };
      }
    },
    async resetPassword(input: ResetPasswordInput) {
      try {
        const body = await post<unknown>(
          '/reset-password',
          input as unknown as Record<string, unknown>,
        );
        if (body && typeof body === 'object' && (body as { status?: boolean }).status === true) {
          return { ok: true as const };
        }
        const b = body as {
          error?: { code?: string; message?: string };
          code?: string;
          message?: string;
        };
        return {
          ok: false as const,
          code: knownCode(b?.error?.code ?? b?.code ?? 'unknown'),
          message: b?.error?.message ?? b?.message ?? 'reset failed',
        };
      } catch {
        return { ok: false as const, code: 'network_error' as SignInErrorCode, message: 'network error' };
      }
    },
    passkey: {
      async register() {
        if (typeof window === 'undefined' || !window.PublicKeyCredential) {
          return {
            ok: false as const,
            code: 'unknown' as SignInErrorCode,
            message: 'WebAuthn not supported in this environment',
          };
        }
        try {
          // Step 1: registration options (needs a fresh session cookie). GET.
          const optRes = await rawGet('/passkey/generate-register-options');
          if (!optRes.ok) {
            return {
              ok: false as const,
              code: 'unknown' as SignInErrorCode,
              message:
                optRes.status === 404 || optRes.status === 501
                  ? 'passkey registration is not enabled for this account'
                  : 'could not start passkey registration',
            };
          }
          const options = (await optRes.json()) as PasskeyRegistrationOptionsJSON;
          // Step 2: browser creates the credential.
          const credential = (await navigator.credentials.create({
            publicKey: {
              challenge: b64urlToBytes(options.challenge),
              rp: options.rp,
              user: {
                id: b64urlToBytes(options.user.id),
                name: options.user.name,
                displayName: options.user.displayName,
              },
              pubKeyCredParams: options.pubKeyCredParams,
              timeout: options.timeout,
              excludeCredentials: (options.excludeCredentials ?? []).map((c) => ({
                id: b64urlToBytes(c.id),
                type: c.type as PublicKeyCredentialType,
                transports: c.transports,
              })),
              authenticatorSelection: options.authenticatorSelection,
              attestation: options.attestation,
            },
          })) as PublicKeyCredential | null;
          if (!credential) {
            return {
              ok: false as const,
              code: 'unknown' as SignInErrorCode,
              message: 'passkey registration cancelled',
            };
          }
          const att = credential.response as AuthenticatorAttestationResponse;
          // Step 3: serialise the credential to @simplewebauthn JSON and verify.
          const response = {
            id: credential.id,
            rawId: bytesToB64url(new Uint8Array(credential.rawId)),
            type: credential.type,
            clientExtensionResults: credential.getClientExtensionResults(),
            authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
            response: {
              clientDataJSON: bytesToB64url(new Uint8Array(att.clientDataJSON)),
              attestationObject: bytesToB64url(new Uint8Array(att.attestationObject)),
              transports: att.getTransports ? att.getTransports() : [],
            },
          };
          const verRes = await rawPost('/passkey/verify-registration', { response });
          if (!verRes.ok) {
            return {
              ok: false as const,
              code: 'unknown' as SignInErrorCode,
              message: 'passkey registration failed',
            };
          }
          return { ok: true as const };
        } catch {
          return {
            ok: false as const,
            code: 'network_error' as SignInErrorCode,
            message: 'passkey registration failed',
          };
        }
      },
      async signIn() {
        if (typeof window === 'undefined' || !window.PublicKeyCredential) {
          return {
            ok: false as const,
            code: 'unknown' as SignInErrorCode,
            message: 'WebAuthn not supported in this environment',
          };
        }
        try {
          // Step 1: authentication options. GET.
          const optRes = await rawGet('/passkey/generate-authenticate-options');
          if (!optRes.ok) {
            return {
              ok: false as const,
              code: 'unknown' as SignInErrorCode,
              message:
                optRes.status === 404 || optRes.status === 501
                  ? 'passkey sign-in is not enabled for this account'
                  : 'could not start passkey sign-in',
            };
          }
          const options = (await optRes.json()) as PasskeyAuthenticationOptionsJSON;
          // Step 2: browser produces the assertion.
          const assertion = (await navigator.credentials.get({
            publicKey: {
              challenge: b64urlToBytes(options.challenge),
              timeout: options.timeout,
              rpId: options.rpId,
              userVerification: options.userVerification,
              allowCredentials: (options.allowCredentials ?? []).map((c) => ({
                id: b64urlToBytes(c.id),
                type: c.type as PublicKeyCredentialType,
                transports: c.transports,
              })),
            },
          })) as PublicKeyCredential | null;
          if (!assertion) {
            return {
              ok: false as const,
              code: 'unknown' as SignInErrorCode,
              message: 'passkey sign-in cancelled',
            };
          }
          const asr = assertion.response as AuthenticatorAssertionResponse;
          // Step 3: serialise the assertion to @simplewebauthn JSON and verify.
          const response = {
            id: assertion.id,
            rawId: bytesToB64url(new Uint8Array(assertion.rawId)),
            type: assertion.type,
            clientExtensionResults: assertion.getClientExtensionResults(),
            authenticatorAttachment: assertion.authenticatorAttachment ?? undefined,
            response: {
              clientDataJSON: bytesToB64url(new Uint8Array(asr.clientDataJSON)),
              authenticatorData: bytesToB64url(new Uint8Array(asr.authenticatorData)),
              signature: bytesToB64url(new Uint8Array(asr.signature)),
              userHandle: asr.userHandle
                ? bytesToB64url(new Uint8Array(asr.userHandle))
                : undefined,
            },
          };
          const body = await post<unknown>('/passkey/verify-authentication', { response });
          return asSignInResult(body);
        } catch {
          return {
            ok: false as const,
            code: 'network_error' as SignInErrorCode,
            message: 'passkey sign-in failed',
          };
        }
      },
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

// ─── passkey (WebAuthn) option shapes + base64url codec ──────────────────
//
// The server returns options in @simplewebauthn JSON form: every buffer
// (challenge, user.id, credential ids) is a base64url string. We decode them
// to byte arrays for the WebAuthn call, then re-encode the resulting
// credential as unpadded base64url for the verify POST.

interface PasskeyCredentialDescriptorJSON {
  id: string;
  type: string;
  transports?: AuthenticatorTransport[];
}

interface PasskeyRegistrationOptionsJSON {
  challenge: string;
  rp: { name: string; id?: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number;
  excludeCredentials?: PasskeyCredentialDescriptorJSON[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: AttestationConveyancePreference;
}

interface PasskeyAuthenticationOptionsJSON {
  challenge: string;
  timeout?: number;
  rpId?: string;
  allowCredentials?: PasskeyCredentialDescriptorJSON[];
  userVerification?: UserVerificationRequirement;
}

function b64urlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i] as number);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

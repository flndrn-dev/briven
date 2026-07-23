import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { runInProjectDatabase } from '../db/data-plane.js';
import { env } from '../env.js';
import { log } from '../lib/logger.js';
import { resolveFallbackFromAddress, resolveFromAddress } from './auth-mailer.js';
import {
  ensureTenantAuthSchema,
  renderAuthProvisioningSql,
} from './auth-provisioning.js';
import { createAuthSdkKey } from './auth-sdk-keys.js';
import { invalidateAuthInstance } from './auth-tenant-pool.js';
import {
  getAuthConfig,
  isAuthEnabled,
  updateAuthConfig,
  type AuthConfig,
} from './tenant-config-store.js';

/**
 * MCP auth bridge — reception desk + agent write tools for THIS project only.
 *
 * READ (every MCP scope):
 *   auth_config_get, sender_domain_status, auth_docs_ask
 *
 * WRITE (read-write / admin MCP keys only — 2026-07-21):
 *   auth_enable_passwordless — turn on magic link + email OTP + passkey
 *   auth_mint_public_key — mint pk_briven_auth_… (plaintext once)
 *
 * Contract:
 *   - One-project scope from the MCP key binding.
 *   - Writes only passwordless toggles + mint public key (not OAuth secrets).
 *   - Vendor-silent prose for email infra.
 */

const DOCS = {
  auth: 'https://docs.briven.tech/auth',
  senderDomain: 'https://docs.briven.tech/auth#sender-domain',
  keys: 'https://docs.briven.tech/auth#keys',
  flows: 'https://docs.briven.tech/auth#flows',
  security: 'https://docs.briven.tech/auth#security',
  verifyTokens: 'https://docs.briven.tech/auth#verify-tokens',
  twoFactor: 'https://docs.briven.tech/auth#two-factor',
  testingTokens: 'https://docs.briven.tech/auth#testing-tokens',
  setup: 'https://docs.briven.tech/auth#setup',
  agents: 'https://docs.briven.tech/auth#agents',
} as const;

/* ── auth_config_get ─────────────────────────────────────────────────── */

/**
 * Sanitize the stored auth config for MCP exposure: OAuth client ids are
 * publishable but still replaced with a set/unset boolean — an agent needs
 * to know WHETHER a provider is wired, never the value, and this keeps the
 * tool output safe to paste anywhere.
 */
export function sanitizeAuthConfig(config: AuthConfig): {
  providers: Record<string, Record<string, unknown>>;
  branding: {
    logoUrl: string | null;
    primaryColor: string;
    senderName: string;
    senderDomain: string | null;
  };
} {
  const providers: Record<string, Record<string, unknown>> = {};
  for (const [name, raw] of Object.entries(config.providers)) {
    const p = raw as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) {
      if (k === 'clientId') out.clientIdSet = typeof v === 'string' && v.length > 0;
      else out[k] = v;
    }
    providers[name] = out;
  }
  return {
    providers,
    branding: {
      logoUrl: config.branding.logoUrl,
      primaryColor: config.branding.primaryColor,
      senderName: config.branding.senderName,
      senderDomain: config.branding.senderDomain,
    },
  };
}

/* ── sender_domain_status ────────────────────────────────────────────── */

interface ProviderDnsRecord {
  type: string;
  name: string;
  value: string;
  ttl: string;
  priority?: string | null;
  status: string;
  recommended?: boolean;
}

type DomainStatusResult =
  | {
      available: true;
      registered: boolean;
      status: string | null;
      verified: boolean;
      dnsRecords: ProviderDnsRecord[];
    }
  | { available: false; reason: string };

/**
 * Ask briven's email infrastructure for the verification state of one
 * sending domain. Fail-soft: any transport problem becomes
 * `{ available: false }` — this tool must never take the MCP request down.
 */
async function fetchDomainStatus(domainName: string): Promise<DomainStatusResult> {
  if (!env.BRIVEN_MITTERA_API_URL || !env.BRIVEN_MITTERA_API_KEY) {
    return {
      available: false,
      reason:
        'email-infrastructure status API is not configured on this deployment; ' +
        'sends still work (fallback sender), only live verification status is unavailable.',
    };
  }
  try {
    const url = `${env.BRIVEN_MITTERA_API_URL.replace(/\/$/, '')}/api/v1/domains`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${env.BRIVEN_MITTERA_API_KEY}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      log.warn('mcp_sender_domain_status_upstream_error', { status: res.status });
      return { available: false, reason: `status API answered ${res.status}` };
    }
    const domains = (await res.json()) as Array<{
      name?: string;
      status?: string;
      dnsRecords?: ProviderDnsRecord[];
    }>;
    const match = Array.isArray(domains)
      ? domains.find((d) => d.name?.toLowerCase() === domainName.toLowerCase())
      : undefined;
    if (!match) {
      return { available: true, registered: false, status: null, verified: false, dnsRecords: [] };
    }
    return {
      available: true,
      registered: true,
      status: match.status ?? null,
      verified: match.status === 'SUCCESS',
      dnsRecords: match.dnsRecords ?? [],
    };
  } catch (err) {
    log.warn('mcp_sender_domain_status_fetch_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { available: false, reason: 'status API unreachable (timeout or network)' };
  }
}

/* ── auth_docs_ask — curated guidance corpus ─────────────────────────── */

export interface AuthGuidanceEntry {
  readonly id: string;
  readonly topic: string;
  readonly keywords: readonly string[];
  /** The briven-side facts. */
  readonly answer: string;
  /** What the REQUESTING agent does in its own project with those facts. */
  readonly applyInYourProject: readonly string[];
  readonly docs: string;
}

export const AUTH_GUIDANCE: readonly AuthGuidanceEntry[] = [
  {
    id: 'briven-engine-fdi',
    topic: 'briven-engine live auth API (replaces auth-tenant)',
    keywords: [
      'briven-engine', 'auth-core', 'fdi', 'auth-tenant', '410', 'engine',
      'doltgres', 'signinup', 'session', 'me', 'proxy', 'first-party',
    ],
    answer:
      'production login is briven-engine on Doltgres (database briven_engine). HTTP base: ' +
      'https://api.briven.tech/v1/auth-core. Passwordless FDI: POST /v1/auth-core/fdi/signinup/code ' +
      'and POST /v1/auth-core/fdi/signinup/code/consume. Session: GET /v1/auth-core/session/me. ' +
      'Social: authorisationurl + signinup under /v1/auth-core/fdi/. WebAuthn under /v1/auth-core/fdi/webauthn/*. ' +
      'Always send x-briven-project-id and x-briven-engine: briven-engine. ' +
      'The old Better Auth surface /v1/auth-tenant/* is retired and returns 410 Gone.',
    applyInYourProject: [
      'prefer a first-party proxy on your app (e.g. /api/auth/*) so sAccessToken cookies are same-site on your domain.',
      'do not call /v1/auth-tenant/* in new code; rewrite any leftover clients to auth-core FDI.',
      'after consume, mint your own app session if you need SSR without calling Briven every request.',
    ],
    docs: DOCS.auth,
  },
  {
    id: 'sender-domain-setup',
    topic: 'brand auth emails as your own domain',
    keywords: ['sender', 'domain', 'brand', 'from', 'address', 'noreply', 'custom', 'email'],
    answer:
      'auth emails send from noreply@briven.tech by default. to send as noreply@yourdomain, ' +
      'the project owner sets sender name + sender domain (ROOT domain, never an auth.* ' +
      'subdomain) under dashboard → auth → branding. the domain then needs DNS verification ' +
      '(SPF + DKIM records briven provides). until verified, sends automatically use the ' +
      'briven fallback — a set-but-unverified domain can never break sign-in.',
    applyInYourProject: [
      'no code change is needed in your app for the sender switch — it happens platform-side the moment the domain verifies.',
      'call sender_domain_status to get the exact DNS records and their live status; add the missing ones at your domain host.',
      'domain registration with briven email infrastructure is platform-side: if sender_domain_status reports registered:false, request registration via an owner handoff — do not try to modify the briven platform yourself.',
    ],
    docs: DOCS.senderDomain,
  },
  {
    id: 'emails-from-fallback',
    topic: 'why do my emails come from noreply@briven.tech?',
    keywords: ['fallback', 'briven.tech', 'noreply', 'still', 'wrong', 'sender', 'why'],
    answer:
      'that is the safe fallback: your sender domain is either empty or not verified yet. ' +
      'briven tries your custom domain first and falls back automatically when the email ' +
      'infrastructure rejects it, so sign-in keeps working during DNS setup.',
    applyInYourProject: [
      'nothing is broken — treat fallback sends as fully functional.',
      'to move to noreply@yourdomain: run sender_domain_status, add the DNS records it lists, wait for verification (rechecked periodically), then re-run it to confirm verified:true.',
    ],
    docs: DOCS.senderDomain,
  },
  {
    id: 'email-not-arriving',
    topic: 'sign-in emails not arriving',
    keywords: ['not', 'arriving', 'missing', 'spam', 'inbox', 'delivery', 'receive', 'email'],
    answer:
      'first check spam. then dashboard → auth → usage for delivery status. a recipient who ' +
      'previously hard-bounced or complained is suppressed and will not be re-sent. note the ' +
      'auth SDK returns ok:true when the API answered at all — it is not delivery proof. ' +
      'an unverified custom senderDomain falls back to noreply@briven.tech automatically — that is success, not a failure.',
    applyInYourProject: [
      'verify the send really returned HTTP 200 by probing POST /v1/auth-core/fdi/signinup/code ' +
        'with headers x-briven-project-id + x-briven-engine: briven-engine and body ' +
        '{ email, flowType: "USER_INPUT_CODE" | "MAGIC_LINK" } — expect status:"OK" and delivery.ok. ' +
        'Old /v1/auth-tenant/* returns 410 Gone; do not probe those paths.',
      'surface a "check your spam folder" hint in your sign-in UI after a magic-link or OTP send.',
    ],
    docs: DOCS.flows,
  },
  {
    id: 'magic-otp-500',
    topic: 'magic link or email OTP returns HTTP 500 empty body',
    keywords: [
      '500', 'empty', 'body', 'magic', 'otp', 'send', 'fail', 'failed', 'error',
      'server', 'broken', 'schema', 'templates',
    ],
    answer:
      'live login uses briven-engine (Doltgres) under /v1/auth-core/*, not the retired auth-tenant surface. ' +
      'HTTP 500 on FDI usually means engine not ready (503 notReady), misconfigured delivery, or a real platform bug — ' +
      'capture x-request-id. Unverified senderDomain is NOT a 500 cause (fallback From is used). ' +
      'CORS allow-origin on a 500 means Allowed Domains already worked — do NOT close with "add domains".',
    applyInYourProject: [
      're-probe POST https://api.briven.tech/v1/auth-core/fdi/signinup/code with x-briven-project-id, ' +
        'x-briven-engine: briven-engine, body { email, flowType: "USER_INPUT_CODE" }; expect 200 { status: "OK", engine: "briven-engine" }.',
      'if still 500: capture x-request-id + origin + path and file a Briven platform handoff — do not invent Clerk or a side mailer.',
      'if HTTP 200 but no inbox: check spam; From may be branded via fallback until sender domain verifies.',
    ],
    docs: DOCS.flows,
  },
  {
    id: 'magic-link-integration',
    topic: 'integrate magic-link sign-in',
    keywords: ['magic', 'link', 'sign', 'in', 'login', 'passwordless', 'integrate', 'sdk'],
    answer:
      'live engine path (Option B / briven-engine): POST /v1/auth-core/fdi/signinup/code with ' +
      '{ email, flowType: "MAGIC_LINK", magicLinkBaseUrl: "https://your.app/auth/consume" }. ' +
      'Engine emails a link with preAuthSessionId + linkCode + deviceId; your page POSTs ' +
      '/v1/auth-core/fdi/signinup/code/consume with those fields. Prefer a first-party proxy ' +
      '(your.app/api/auth/* → api.briven.tech) so session cookies (sAccessToken) sit on YOUR domain (Safari-safe). ' +
      'Headers: x-briven-project-id, x-briven-engine: briven-engine. /v1/auth-tenant/* is retired (410).',
    applyInYourProject: [
      'register every origin under auth → allowed domains.',
      'proxy FDI through your domain and rewrite Set-Cookie to first-party Path=/; SameSite=Lax.',
      'after consume, call GET /v1/auth-core/session/me (or your proxy /api/auth/session/me) with credentials:include.',
      'treat HTTP 200 + status:OK as send accepted, not inbox proof.',
    ],
    docs: DOCS.flows,
  },
  {
    id: 'email-otp-integration',
    topic: 'integrate email OTP sign-in',
    keywords: ['otp', 'code', 'one', 'time', 'email', 'verification', 'sign-in'],
    answer:
      'briven-engine OTP: POST /v1/auth-core/fdi/signinup/code with { email, flowType: "USER_INPUT_CODE" } ' +
      '→ response preAuthSessionId + deviceId (store client-side). User enters 6-digit code → ' +
      'POST /v1/auth-core/fdi/signinup/code/consume with { preAuthSessionId, deviceId, userInputCode }. ' +
      'Success sets sAccessToken + sRefreshToken cookies. Prefer first-party proxy so cookies land on your app host. ' +
      'Do not use /v1/auth-tenant/email-otp/* (410).',
    applyInYourProject: [
      'never invent a local OTP table — engine stores hashed codes in briven_engine.',
      'same Allowed Domains + first-party proxy rules as magic link.',
      'session check: GET /v1/auth-core/session/me with credentials:include and x-briven-project-id.',
    ],
    docs: DOCS.flows,
  },
  {
    id: 'keys',
    topic: 'which key goes where',
    keywords: ['key', 'keys', 'pk', 'brk', 'publishable', 'secret', 'api'],
    answer:
      'pk_briven_auth_* = browser-safe publishable auth key (end-user sign-in surface only). ' +
      'brk_* = server data keys, never in client code. pk_briven_mcp_* = this MCP connection, ' +
      'bound to one project and scope.',
    applyInYourProject: [
      'ship pk_briven_auth_* in your client bundle freely; keep brk_* server-side only (env var, never committed).',
      'if a brk_ key ever appeared in chat/logs/git, rotate it in dashboard → api keys.',
    ],
    docs: DOCS.keys,
  },
  {
    id: 'providers-config',
    topic: 'enable or configure sign-in providers',
    keywords: [
      'provider', 'providers', 'enable', 'otp', 'passkey', 'oauth', 'google', 'github',
      'toggle', 'konnos', 'clientid', 'secret',
    ],
    answer:
      'ALWAYS call auth_config_get first. Magic link / email OTP / passkey / password only need ' +
      'enabled:true (no secrets). OAuth (google, github, konnos, …) needs enabled:true AND clientIdSet:true ' +
      'AND a stored client secret — toggle alone does NOT activate the button. ' +
      'If magic/OTP/passkey are OFF and your MCP key is read-write or admin: call auth_enable_passwordless once ' +
      '(or PATCH /v1/projects/:id/auth/config with Bearer brk_ admin key). ' +
      'If they already show enabled:true, do NOT re-nag the owner — wire the app.',
    applyInYourProject: [
      'write-scope MCP: auth_enable_passwordless then auth_mint_public_key if you lack pk_briven_auth_….',
      'HTTP (admin brk_): PATCH /v1/projects/{id}/auth/config with providers.magicLink/emailOtp/passkey enabled true.',
      'offer UI only for providers with enabled:true; for OAuth also require clientIdSet:true.',
      'never invent Clerk/Firebase Auth.',
    ],
    docs: DOCS.auth,
  },
  {
    id: 'passkey-webauthn',
    topic: 'passkey / Face ID / WebAuthn routes and integration',
    keywords: [
      'passkey', 'passkeys', 'webauthn', 'face', 'touch', 'biometric', '404',
      'generate', 'authenticate', 'register', 'options', 'fido',
    ],
    answer:
      'when passkey is enabled, briven-engine WebAuthn is live under /v1/auth-core/fdi/webauthn/*: ' +
      'POST …/webauthn/signin/options, POST …/webauthn/signin/finish, ' +
      'POST …/webauthn/register/options (needs session), POST …/webauthn/register/finish, ' +
      'GET …/webauthn/credentials, DELETE …/webauthn/credentials/:id. ' +
      'Face ID/Touch ID is the device — NOT a "wait for platform update". ' +
      'Old Better Auth /v1/auth-tenant/passkey/* paths are retired (410). ' +
      'rpID should be a parent domain of your host. Allowed Domains must include the app origin.',
    applyInYourProject: [
      'use the FDI webauthn routes above (or a first-party proxy to them); do not call retired auth-tenant passkey paths.',
      'register passkey only after a normal session (magic link/OTP/password); then sign-in with Face ID.',
      'if options return OK but browser fails: check HTTPS, Allowed Domains, and that rpId is a parent of your host.',
    ],
    docs: DOCS.auth,
  },
  {
    id: 'verify-tokens-jwt-jwks',
    topic: 'verify a session locally with tokens (JWT + JWKS)',
    keywords: ['jwt', 'jwks', 'token', 'tokens', 'verify', 'verifiable', 'verification', 'locally', 'stateless', 'bearer'],
    answer:
      'preferred live path: session cookie sAccessToken (value is the engine session handle) plus ' +
      'GET /v1/auth-core/session/me with credentials:include and x-briven-project-id. ' +
      'Many apps mint their OWN first-party signed cookie after me succeeds (e.g. konnos_session) so SSR ' +
      'does not depend on Briven every request. Retired auth-tenant /token and /jwks return 410 — do not wire new apps to them.',
    applyInYourProject: [
      'after OTP/magic/OAuth consume, call GET /v1/auth-core/session/me (via first-party proxy if possible).',
      'optionally mint your app session cookie from that identity (HMAC JWT or similar) for SSR.',
      'do not depend on GET /v1/auth-tenant/token or /jwks for new work.',
    ],
    docs: DOCS.verifyTokens,
  },
  {
    id: 'sessions-cookies',
    topic: 'sessions and cross-domain cookies',
    keywords: ['session', 'cookie', 'stick', 'logged', 'out', 'cross', 'domain', 'cors'],
    answer:
      'briven-engine sets HttpOnly sAccessToken + sRefreshToken on successful consume/sign-in. ' +
      'If the browser talks to api.briven.tech directly, those cookies are third-party on your site and Safari may block them. ' +
      'Production pattern: proxy /api/auth/* on YOUR origin to /v1/auth-core/fdi/* (+ session/me), rewrite Set-Cookie to first-party on your host.',
    applyInYourProject: [
      'implement a same-origin auth proxy; strip upstream Domain, set Path=/ and SameSite=Lax.',
      'gate protected pages on your own session cookie or server-side session/me with the first-party Briven cookies.',
      'never log user emails or IPs from auth traffic.',
    ],
    docs: DOCS.security,
  },
  {
    id: 'two-factor-backup-codes',
    topic: 'two-factor and lost-phone backup codes',
    keywords: [
      'two',
      'factor',
      '2fa',
      'mfa',
      'totp',
      'backup',
      'recovery',
      'code',
      'codes',
      'authenticator',
      'lost',
      'phone',
    ],
    answer:
      'when 2FA is on, password sign-in may return twoFactorRequired. finish with ' +
      'auth.twoFactor.verify (TOTP app code) or auth.twoFactor.verifyBackupCode (single-use ' +
      'recovery codes for lost phones). enroll with enable → verify → generateBackupCodes ' +
      'and show the codes once. hosted path: /auth/<projectId>/two-factor.',
    applyInYourProject: [
      'after signIn.email, if result.ok && "twoFactorRequired" in result, show TwoFactorChallenge or redirect to the hosted two-factor page.',
      'never store backup codes in your database — only the user should keep them offline.',
      'use auth.twoFactor.verify (not a made-up /two-factor/verify path) — the live endpoint is verify-totp under the hood.',
    ],
    docs: DOCS.twoFactor,
  },
  {
    id: 'testing-tokens-e2e',
    topic: 'testing tokens for e2e / ci',
    keywords: ['test', 'testing', 'token', 'e2e', 'ci', 'playwright', 'bypass', 'mfa'],
    answer:
      'mint a short-lived briven_test_… token as a project admin (dashboard or POST ' +
      '/v1/projects/:id/auth/test-tokens). exchange it with auth.signIn.testToken(raw) to get ' +
      'a real session without MFA/rate-limit friction. raw token is shown once; revoke after CI.',
    applyInYourProject: [
      'store the raw token only in CI secrets (BRIVEN_AUTH_TEST_TOKEN), never in git.',
      'call createBrivenAuth({ projectId, publicKey }) then auth.signIn.testToken(process.env.BRIVEN_AUTH_TEST_TOKEN!).',
      'do not use testing tokens for real end users in production flows.',
    ],
    docs: DOCS.testingTokens,
  },
  {
    id: 'password-policy',
    topic: 'password policy and force reset',
    keywords: [
      'password',
      'policy',
      'weak',
      'length',
      'reuse',
      'expired',
      'force',
      'reset',
      'complexity',
    ],
    answer:
      'per-project password policy covers min length, character classes, max age, and reuse. ' +
      'admins can force a password change on next sign-in. weak passwords are rejected on ' +
      'sign-up/reset/change; expired or force-reset users cannot open a session until they reset.',
    applyInYourProject: [
      'read policy via dashboard or GET /v1/projects/:id/auth/password-policy before showing signup rules in your UI.',
      'surface the server error message (code weak_password) next to the password field — do not invent rules that disagree with the project policy.',
    ],
    docs: DOCS.security,
  },
  {
    id: 'new-device-sessions',
    topic: 'new device alerts and session revoke',
    keywords: ['device', 'new', 'session', 'sessions', 'revoke', 'alert', 'fingerprint'],
    answer:
      'on sign-in from an unseen browser fingerprint, briven can email a new-device notice ' +
      '(no raw IPs stored). admins can list sessions/devices for a user and revoke a ' +
      'specific session. end users can list/revoke via the SDK sessions helpers.',
    applyInYourProject: [
      'offer a "sessions" settings page using auth.sessions.list() / auth.sessions.revoke(sessionId).',
      'tell users to check spam if they do not see new-device mail; branding/sender domain still applies.',
    ],
    docs: DOCS.security,
  },
  {
    id: 'scaffold-setup',
    topic: 'scaffold briven auth into a next app',
    keywords: [
      'scaffold', 'setup', 'middleware', 'next', 'briven auth scaffold', 'pilot',
      'connect', 'link',
    ],
    answer:
      'wire the folder first: briven setup <name> for a NEW cloud project, or briven connect p_… ' +
      'for an EXISTING one (never setup --project). then briven auth scaffold + install @briven/auth. ' +
      'that writes middleware.ts, lib/auth.ts, and .env.local seeds. paste pk_briven_auth_…, then ' +
      'hostedPageURL or BrivenSignIn. prove with AUTH-GO-LIVE-CHECKLIST.md.',
    applyInYourProject: [
      'briven setup OR briven connect, then briven auth scaffold — do not invent setup --project.',
      'set NEXT_PUBLIC_BRIVEN_API_ORIGIN, NEXT_PUBLIC_BRIVEN_PROJECT_ID, NEXT_PUBLIC_BRIVEN_AUTH_KEY, BRIVEN_AUTH_PUBLIC_KEY (same pk value for middleware).',
      'copy examples/auth-pilot/ for a minimal hosted sign-in button pattern.',
    ],
    docs: DOCS.setup,
  },
  {
    id: 'allowed-domains-cors',
    topic: 'allowed domains / CORS / origin rejected',
    keywords: [
      'allowed', 'domains', 'domain', 'cors', 'origin', 'access-control', 'forbidden',
      'app', 'domains',
    ],
    answer:
      'every browser Origin that calls /v1/auth-core/* (or your first-party auth proxy) must be listed under the project ' +
      'Auth → Allowed Domains (exact scheme+host, e.g. https://konnos.org and ' +
      'http://localhost:3000 separately). when CORS returns access-control-allow-origin for your ' +
      'origin, domains are fine — a later 500 is not a domains problem. /v1/auth-tenant/* is retired (410).',
    applyInYourProject: [
      'add every production + local origin the human uses; retest with Origin header matching the list.',
      'do not tell the owner to "re-add domains" if the failing response already shows the correct allow-origin.',
    ],
    docs: DOCS.auth,
  },
] as const;

export function tokeniseQuestion(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/**
 * Score guidance entries against a free-form question (same word-overlap
 * approach as the public docs search). Exported for tests.
 */
export function matchAuthGuidance(question: string, limit = 3): AuthGuidanceEntry[] {
  const tokens = new Set(tokeniseQuestion(question));
  const scored = AUTH_GUIDANCE.map((entry) => {
    let score = 0;
    for (const k of entry.keywords) if (tokens.has(k)) score += 2;
    for (const t of tokeniseQuestion(entry.topic)) if (tokens.has(t)) score += 1;
    return { entry, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.entry);
}

/* ── registration ────────────────────────────────────────────────────── */

/**
 * Register auth-bridge tools. Read tools: every MCP scope. Write tools:
 * only when `opts.allowWrites` (read-write / admin MCP keys).
 */
export function registerAuthBridgeTools(
  server: McpServer,
  ctx: { projectId: string },
  auditCall: (tool: string, metadata: Record<string, unknown>) => Promise<void>,
  jsonResult: (payload: unknown) => { content: { type: 'text'; text: string }[] },
  opts?: { allowWrites?: boolean },
): void {
  server.registerTool(
    'auth_config_get',
    {
      title: 'Auth config (read-only)',
      description:
        'Read YOUR project\'s auth configuration: which sign-in providers are enabled ' +
        '(with settings), and the email branding (sender name, sender domain, colors). ' +
        'Secrets and OAuth client ids are never returned. ' +
        'To turn on magic/OTP/passkey with a write-scope MCP key, use auth_enable_passwordless. ' +
        'To mint pk_briven_auth_… use auth_mint_public_key.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      await auditCall('auth_config_get', {});
      const config = await getAuthConfig(ctx.projectId);
      const sanitized = sanitizeAuthConfig(config);
      const enabled = await isAuthEnabled(ctx.projectId).catch(() => false);
      return jsonResult({
        authEnabled: enabled,
        config: sanitized,
        guidance: {
          summary:
            'build your sign-in UI from this live config. with a read-write/admin MCP key ' +
            'call auth_enable_passwordless to turn on magic+OTP+passkey, and auth_mint_public_key ' +
            'for a browser pk_briven_auth_… key.',
          applyInYourProject: [
            'if magicLink/emailOtp/passkey show enabled:true, do NOT re-ask the owner to toggle them — wire the app.',
            'if they are false and your MCP key is write-scope: call auth_enable_passwordless once, then auth_config_get again.',
            'OAuth (google/konnos/…): needs enabled:true AND clientIdSet:true AND a secret in the dashboard; toggle alone is not enough.',
            'live engine (briven-engine): POST /v1/auth-core/fdi/signinup/code for OTP or MAGIC_LINK; POST …/signinup/code/consume to finish; GET /v1/auth-core/session/me for session.',
            'headers on every engine call: x-briven-project-id + x-briven-engine: briven-engine. Prefer first-party /api/auth proxy for cookies.',
            'passkey: POST /v1/auth-core/fdi/webauthn/signin/options then …/signin/finish (register paths under webauthn/register/*).',
            'retired: /v1/auth-tenant/* returns 410 — do not wire new apps to it.',
            'every Origin must be under Auth → Allowed Domains; if CORS already allows your origin, do not blame domains for other errors.',
            'keys: pk_briven_auth_… in the browser only; never brk_.',
          ],
          docs: DOCS.auth,
        },
      });
    },
  );

  server.registerTool(
    'sender_domain_status',
    {
      title: 'Sender domain verification status',
      description:
        'Check YOUR project\'s email sender domain: is one set, is it verified with ' +
        'briven\'s email infrastructure, and exactly which DNS records (with live ' +
        'per-record status) still need to be added at the domain host. Also explains ' +
        'which From: address your auth emails use today.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      await auditCall('sender_domain_status', {});
      const config = await getAuthConfig(ctx.projectId);
      const senderDomain = config.branding.senderDomain;

      if (!senderDomain) {
        return jsonResult({
          senderDomain: null,
          fromAddressToday: resolveFallbackFromAddress(config),
          verification: null,
          guidance: {
            summary:
              'no sender domain is set — auth emails send from the briven fallback, which ' +
              'is fully functional. set a domain only when you want branded From: addresses.',
            applyInYourProject: [
              'nothing required. to brand emails, the project owner fills sender domain (root domain, e.g. yourapp.com) under dashboard → auth → branding, then re-runs this tool for the DNS records.',
            ],
            docs: DOCS.senderDomain,
          },
        });
      }

      const status = await fetchDomainStatus(senderDomain);
      const verified = status.available === true && status.verified;
      const pendingRecords =
        status.available === true
          ? status.dnsRecords.filter((r) => r.status !== 'SUCCESS')
          : [];

      return jsonResult({
        senderDomain,
        fromAddressToday: verified ? resolveFromAddress(config) : resolveFallbackFromAddress(config),
        fromAddressWhenVerified: resolveFromAddress(config),
        verification: status,
        guidance: {
          summary: verified
            ? 'domain verified — auth emails send as your branded From: address. nothing to do.'
            : status.available && !status.registered
              ? 'the domain is set in branding but not yet registered with briven\'s email ' +
                'infrastructure. registration is platform-side: request it via an owner ' +
                'handoff. until then emails send from the briven fallback — sign-in keeps working.'
              : 'the domain is set but not fully verified. add the DNS records listed under ' +
                'verification.dnsRecords (those not marked SUCCESS) at the domain host, then ' +
                're-run this tool. until verified, emails send from the briven fallback — ' +
                'sign-in keeps working.',
          applyInYourProject: [
            'do NOT clear the sender domain to "fix" email — the automatic fallback already keeps sign-in working.',
            pendingRecords.length > 0
              ? `add these ${pendingRecords.length} DNS record(s) at the ${senderDomain} DNS host exactly as given, then allow up to an hour for propagation.`
              : 'no DNS action derivable right now — see verification.available/summary for the reason.',
            'never modify the briven platform from your project session; platform-side steps go through an owner handoff.',
          ],
          docs: DOCS.senderDomain,
        },
      });
    },
  );

  server.registerTool(
    'auth_docs_ask',
    {
      title: 'Ask about briven auth (guidance)',
      description:
        'Ask a free-form question about briven auth / sign-in emails / sender domains / ' +
        'keys / sessions. Returns curated guidance: the briven-side facts, concrete ' +
        '"apply in your project" steps for YOUR codebase, and the official docs page. ' +
        'Read-only; grounded in briven\'s documented behavior, not speculation.',
      inputSchema: {
        question: z.string().min(3).max(500).describe('Your question in plain words'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ question }) => {
      await auditCall('auth_docs_ask', { length: question.length });
      const matches = matchAuthGuidance(question);
      if (matches.length === 0) {
        return jsonResult({
          matches: [],
          guidance: {
            summary:
              'no curated answer matched. read the auth docs page — it covers install, keys, ' +
              'flows, sender domain, and security — or rephrase with words like "sender ' +
              'domain", "magic link", "keys", "session".',
            docs: DOCS.auth,
          },
        });
      }
      return jsonResult({
        matches: matches.map((m) => ({
          topic: m.topic,
          answer: m.answer,
          applyInYourProject: m.applyInYourProject,
          docs: m.docs,
        })),
        note:
          'answers are curated and cite the official docs. for live state, combine with ' +
          'auth_config_get and sender_domain_status. write-scope keys may call ' +
          'auth_enable_passwordless and auth_mint_public_key.',
      });
    },
  );

  if (opts?.allowWrites) {
    server.registerTool(
      'auth_enable_passwordless',
      {
        title: 'Enable magic link + email OTP + passkey',
        description:
          'Enable passwordless sign-in for THIS project: magic link, email OTP, and passkey. ' +
          'Also ensures Auth is provisioned (tables + auth_enabled). Does NOT set OAuth secrets. ' +
          'Write-scope MCP keys only. Call auth_config_get after to verify.',
        annotations: { readOnlyHint: false },
      },
      async () => {
        await auditCall('auth_enable_passwordless', {});
        const projectId = ctx.projectId;
        // Provision tables if needed (idempotent).
        const statements = renderAuthProvisioningSql();
        await runInProjectDatabase(projectId, async (tx) => {
          for (const stmt of statements) {
            await tx.unsafe(stmt);
          }
          const txClient = {
            query: async (sql: string, params?: unknown[]) => {
              const rows = await tx.unsafe(sql, (params ?? []) as never);
              return { rows: Array.isArray(rows) ? rows : [] };
            },
          };
          await ensureTenantAuthSchema(txClient);
          await tx.unsafe(
            `INSERT INTO "_briven_meta" (key, value)
             VALUES ('auth_enabled', 'true'::jsonb)
             ON CONFLICT (key) DO NOTHING`,
          );
          await tx.unsafe(
            `UPDATE "_briven_meta" SET value = 'true'::jsonb WHERE key = 'auth_enabled'`,
          );
        });
        const next = await updateAuthConfig(projectId, {
          providers: {
            magicLink: { enabled: true },
            emailOtp: { enabled: true },
            passkey: { enabled: true },
          },
        });
        await invalidateAuthInstance(projectId);
        return jsonResult({
          ok: true,
          authEnabled: true,
          providers: {
            magicLink: next.providers.magicLink,
            emailOtp: next.providers.emailOtp,
            passkey: next.providers.passkey,
          },
          guidance: {
            summary:
              'passwordless providers are ON. mint a browser key with auth_mint_public_key if ' +
              'you do not already have pk_briven_auth_…, register Allowed Domains, then wire ' +
              'briven-engine FDI (POST /v1/auth-core/fdi/signinup/code + consume) preferably via a first-party proxy.',
            applyInYourProject: [
              'set NEXT_PUBLIC_BRIVEN_AUTH_KEY / BRIVEN_AUTH_PUBLIC_KEY to a read-write pk_briven_auth_… key when using publishable-key flows.',
              'OTP/magic: POST /v1/auth-core/fdi/signinup/code then …/code/consume; session: GET /v1/auth-core/session/me.',
              'passkey: POST /v1/auth-core/fdi/webauthn/signin/options then …/signin/finish.',
              'do not call retired /v1/auth-tenant/* (410).',
            ],
            docs: DOCS.auth,
          },
        });
      },
    );

    server.registerTool(
      'auth_mint_public_key',
      {
        title: 'Mint pk_briven_auth_ public key',
        description:
          'Create a browser-safe Auth public key (pk_briven_auth_…) for THIS project. ' +
          'Returns the plaintext ONCE — store it in the app env immediately. Write-scope only. ' +
          'Default scope is read-write (sign-in surface).',
        inputSchema: {
          name: z
            .string()
            .min(1)
            .max(64)
            .default('mcp-minted')
            .describe('Label for the key in the dashboard'),
          scope: z
            .enum(['read', 'read-write', 'admin'])
            .default('read-write')
            .describe('Auth SDK key scope'),
        },
        annotations: { readOnlyHint: false },
      },
      async ({ name, scope }) => {
        await auditCall('auth_mint_public_key', { name, scope });
        const created = await createAuthSdkKey({
          projectId: ctx.projectId,
          createdBy: `mcp:${ctx.projectId}`,
          name,
          scope,
        });
        return jsonResult({
          ok: true,
          key: {
            id: created.record.id,
            name: created.record.name,
            prefix: created.record.prefix,
            suffix: created.record.suffix,
            scope: created.record.scope,
            createdAt: created.record.createdAt.toISOString(),
          },
          plaintext: created.plaintext,
          guidance: {
            summary:
              'copy plaintext into NEXT_PUBLIC_BRIVEN_AUTH_KEY and BRIVEN_AUTH_PUBLIC_KEY now — it is not shown again.',
            applyInYourProject: [
              'never put brk_ or MCP keys in the browser; only this pk_briven_auth_… value.',
            ],
            docs: DOCS.keys,
          },
        });
      },
    );
  }
}

/** Read tools — every MCP scope. */
export const AUTH_BRIDGE_TOOLS = [
  'auth_config_get',
  'sender_domain_status',
  'auth_docs_ask',
] as const;

/** Write tools — read-write / admin MCP keys only. */
export const AUTH_BRIDGE_WRITE_TOOLS = [
  'auth_enable_passwordless',
  'auth_mint_public_key',
] as const;

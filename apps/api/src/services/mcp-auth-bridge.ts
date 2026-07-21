import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { env } from '../env.js';
import { log } from '../lib/logger.js';
import { resolveFallbackFromAddress, resolveFromAddress } from './auth-mailer.js';
import { getAuthConfig, type AuthConfig } from './tenant-config-store.js';

/**
 * MCP auth bridge (v1) — the "reception desk" for other projects' agents.
 *
 * Three READ+GUIDANCE tools on the per-project MCP so an agent building ON
 * briven (konnos, videodj, …) can ask auth/email questions directly instead
 * of a human relaying between sessions:
 *
 *   auth_config_get      — your own auth setup, sanitized
 *   sender_domain_status — is my sender domain verified? which DNS records?
 *   auth_docs_ask        — free-form auth question → curated guidance
 *
 * Contract (owner-approved 2026-07-07):
 *   - READ + GUIDANCE ONLY. No config writes through the MCP — changing auth
 *     settings stays a dashboard action so nothing can silently reconfigure
 *     a tenant.
 *   - One-project scope: everything derives from the verified key binding,
 *     same isolation contract as every other tool in mcp-tools.ts.
 *   - Every answer carries an `applyInYourProject` guidance block written for
 *     the REQUESTING agent to convert into work in ITS OWN codebase, and
 *     cites the public docs page so agents learn the official path.
 *   - Vendor-silent prose: the email infrastructure is described as briven's,
 *     never by vendor name. Raw DNS record values are relayed as-is (they are
 *     technical values a registrar needs verbatim).
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
      'verify the send really returned HTTP 200 by probing POST /v1/auth-tenant/sign-in/magic-link (or email-otp/send-verification-otp) with origin + x-briven-project-id + Bearer pk_briven_auth_… — empty HTTP 500 is a platform schema issue (report with x-request-id), not "re-toggle providers".',
      'surface a "check your spam folder" hint in your sign-in UI after a magic-link send.',
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
      'platform root cause (fixed fleet-wide 2026-07-21): older Enable Auth DBs were missing ' +
      '_briven_auth_email_templates and/or two_factor_enabled — magic-link / email-OTP send then ' +
      'threw empty 500s. all auth-enabled project DBs were healed; new boots self-heal; re-Enable Auth runs ensure. ' +
      'CORS allow-origin on a 500 means Allowed Domains already worked — do NOT close with "add domains". ' +
      'unverified senderDomain is NOT a 500 cause (fallback From is used).',
    applyInYourProject: [
      're-probe POST /v1/auth-tenant/sign-in/magic-link and POST /v1/auth-tenant/email-otp/send-verification-otp with your project id + pk_briven_auth_ + Origin; expect 200 {status:true} / {success:true}.',
      'if still 500 after fleet heal: capture x-request-id + origin + path and file a Briven platform handoff — do not invent Clerk or a side mailer.',
      'if HTTP 200 but no inbox: check spam; From may be "your brand" <noreply@briven.tech> until sender domain verifies.',
    ],
    docs: DOCS.flows,
  },
  {
    id: 'magic-link-integration',
    topic: 'integrate magic-link sign-in',
    keywords: ['magic', 'link', 'sign', 'in', 'login', 'passwordless', 'integrate', 'sdk'],
    answer:
      'call auth_config_get first — only wire magic link if providers.magicLink.enabled is true ' +
      '(do not re-ask the owner to toggle if already true). then auth.signIn.magicLink({ email, redirectTo }) ' +
      'from @briven/auth. the emailed link carries the tenant id. every app origin must be under ' +
      'auth → allowed domains / app domains. path: POST /v1/auth-tenant/sign-in/magic-link.',
    applyInYourProject: [
      'create the client with createBrivenAuth({ projectId, publicKey: "pk_briven_auth_..." }) — the pk_ key is browser-safe, brk_ keys are not.',
      'register every origin your app serves from under auth → allowed domains, or CORS/origin gate rejects.',
      'set redirectTo to the page in YOUR app where a signed-in user should land; treat HTTP 200 as send accepted, not inbox proof.',
    ],
    docs: DOCS.flows,
  },
  {
    id: 'email-otp-integration',
    topic: 'integrate email OTP sign-in',
    keywords: ['otp', 'code', 'one', 'time', 'email', 'verification', 'sign-in'],
    answer:
      'when emailOtp.enabled is true (auth_config_get), send with POST /v1/auth-tenant/email-otp/send-verification-otp ' +
      'body { email, type: "sign-in" }, then verify the 6-digit code with the Better Auth / @briven/auth OTP verify path. ' +
      'codeLength and expiryMinutes come from config.',
    applyInYourProject: [
      'use @briven/auth OTP helpers or the documented HTTP paths; never invent a local OTP table.',
      'same Allowed Domains + pk_briven_auth_ rules as magic link.',
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
      'If magicLink/emailOtp/passkey already show enabled:true, do NOT re-nag the owner to toggle them; ' +
      'wire the app. provider edits are dashboard-only (this MCP is read-only).',
    applyInYourProject: [
      'offer UI only for providers with enabled:true; for OAuth also require clientIdSet:true or ask owner for Client ID+secret once.',
      'never invent Clerk/Firebase Auth because a toggle is on but OAuth secrets are missing.',
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
      'when passkey.enabled is true, WebAuthn is live. Face ID/Touch ID is the device — NOT a "wait for platform update". ' +
      'Better Auth routes (base /v1/auth-tenant): ' +
      'GET /passkey/generate-authenticate-options (sign-in options — POST on this path is 404 BY DESIGN), ' +
      'POST /passkey/verify-authentication, ' +
      'GET /passkey/generate-register-options (needs signed-in session), ' +
      'POST /passkey/verify-registration, ' +
      'GET /passkey/list-user-passkeys. ' +
      'Use @briven/auth auth.passkey.signIn() / register() (full ceremony) or those exact methods. ' +
      'rpID is the parent domain (e.g. briven.tech for *.briven.tech apps). Allowed Domains must include the app origin.',
    applyInYourProject: [
      'never probe generate-*-options with POST and claim "passkey broken" — use GET, expect 200 + challenge.',
      'register passkey only after a normal session (magic link/OTP/password); then signIn with Face ID.',
      'if GET options returns 200 but browser fails: check HTTPS, Allowed Domains, and that rpId is a parent of your host.',
    ],
    docs: DOCS.auth,
  },
  {
    id: 'verify-tokens-jwt-jwks',
    topic: 'verify a session locally with tokens (JWT + JWKS)',
    keywords: ['jwt', 'jwks', 'token', 'tokens', 'verify', 'verifiable', 'verification', 'locally', 'stateless', 'bearer'],
    answer:
      'every project\'s auth surface exposes two endpoints for local session verification: ' +
      'GET /v1/auth-tenant/token (requires the signed-in session cookie; returns { token }, ' +
      'a short-lived signed JWT for the current user) and GET /v1/auth-tenant/jwks (public, ' +
      'no auth; returns the project\'s JSON Web Key Set). your app verifies the JWT against ' +
      'the JWKS with any standard JWT library — no get-session round-trip per request. ' +
      'signing keys are per-project; rotation is handled through the JWKS endpoint.',
    applyInYourProject: [
      'from the signed-in browser, fetch https://api.briven.tech/v1/auth-tenant/token with credentials:include plus your x-briven-project-id header, and pass the returned token to your own backend (e.g. as an authorization: Bearer header).',
      'on your server, verify the token against https://api.briven.tech/v1/auth-tenant/jwks (same x-briven-project-id header) using a standard JWT library with remote-JWKS support — cache the key set, and refetch it when verification hits an unknown key id (that is how key rotation lands).',
      'tokens are short-lived by design: refetch /token when verification reports expiry instead of storing one long-term, and keep get-session for the moments you need the full session object.',
    ],
    docs: DOCS.verifyTokens,
  },
  {
    id: 'sessions-cookies',
    topic: 'sessions and cross-domain cookies',
    keywords: ['session', 'cookie', 'stick', 'logged', 'out', 'cross', 'domain', 'cors'],
    answer:
      'sessions live in an http cookie set by the auth service; the SDK sends ' +
      'credentials:include so the browser stores and returns it. server-side rendering on ' +
      'YOUR domain cannot read a cookie scoped to the auth service domain — check the ' +
      'session client-side or via the SDK server helpers, and never log user emails or IPs.',
    applyInYourProject: [
      'gate protected pages with a client-side session check (useSession) or the SDK server helpers rather than reading raw cookies on your server.',
      'after sign-in/out, call refresh() on your session hook so the UI updates without a reload.',
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
      'every browser Origin that calls /v1/auth-tenant/* must be listed under the project ' +
      'Auth → Allowed Domains (exact scheme+host, e.g. https://pay.apps.briven.tech and ' +
      'http://localhost:3000 separately). when CORS returns access-control-allow-origin for your ' +
      'origin, domains are fine — a later 500 is not a domains problem.',
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
 * Register the three auth-bridge tools. Read-tools: available to EVERY key
 * scope. `auditCall` is the same audit helper mcp-tools.ts builds for the
 * data tools, so auth-bridge calls appear in the same `mcp.tool.*` stream.
 */
export function registerAuthBridgeTools(
  server: McpServer,
  ctx: { projectId: string },
  auditCall: (tool: string, metadata: Record<string, unknown>) => Promise<void>,
  jsonResult: (payload: unknown) => { content: { type: 'text'; text: string }[] },
): void {
  server.registerTool(
    'auth_config_get',
    {
      title: 'Auth config (read-only)',
      description:
        'Read YOUR project\'s auth configuration: which sign-in providers are enabled ' +
        '(with settings), and the email branding (sender name, sender domain, colors). ' +
        'Secrets and OAuth client ids are never returned. Includes guidance on how to ' +
        'apply the config in your own app. Config changes are dashboard-only.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      await auditCall('auth_config_get', {});
      const config = await getAuthConfig(ctx.projectId);
      const sanitized = sanitizeAuthConfig(config);
      return jsonResult({
        config: sanitized,
        guidance: {
          summary:
            'build your sign-in UI from this live config. dashboard-only for changes ' +
            '(auth → providers / branding / allowed domains). this MCP is read-only.',
          applyInYourProject: [
            'if magicLink/emailOtp/passkey show enabled:true, do NOT re-ask the owner to toggle them — wire the app.',
            'OAuth (google/konnos/…): needs enabled:true AND clientIdSet:true AND a secret in the dashboard; toggle alone is not enough.',
            'magic link: POST /v1/auth-tenant/sign-in/magic-link — expect 200 (not empty 500).',
            'email OTP send: POST /v1/auth-tenant/email-otp/send-verification-otp with type:"sign-in".',
            'passkey: GET /v1/auth-tenant/passkey/generate-authenticate-options (POST on that path is 404 by design); then WebAuthn; then POST …/verify-authentication. use @briven/auth passkey.signIn()/register(). Face ID is the device, not a missing platform feature.',
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
          'auth_config_get and sender_domain_status.',
      });
    },
  );
}

/** Tool names this module registers — kept in lock-step with READ_TOOLS. */
export const AUTH_BRIDGE_TOOLS = [
  'auth_config_get',
  'sender_domain_status',
  'auth_docs_ask',
] as const;

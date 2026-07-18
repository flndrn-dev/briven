---
name: briven-auth
description: "Wire Briven end-user sign-in into a client app (@briven/auth, hosted pages, scaffold). Use when the user names Briven and wants login/signup/sessions — not admin brk_ API keys alone."
---

# Briven — User Authentication (agent playbook)

End-user auth for apps on Briven. Sessions are **httpOnly cookies** set by the Briven API. The browser-safe key is `pk_briven_auth_…` (not `brk_…`).

**Docs:** https://docs.briven.tech/auth  
**Manual go-live checklist (human):** `AUTH-GO-LIVE-CHECKLIST.md` in the Briven repo.  
**Pilot:** `examples/auth-pilot/`

## When to use

- “Add Briven auth / login / sign-up to this app”
- Protect routes with a signed-in user
- Scaffold Next.js middleware proxy to Briven auth
- 2FA / backup codes / testing tokens for e2e

## When NOT to use

- Only needs server-to-server data (`brk_` keys) → `briven-connect` / MCP data tools
- Briven project not created yet → `briven-setup`
- Third-party IdP with **no** Briven tenant in the middle

## Auth model (facts — not TODOs)

| Piece | Reality |
| --- | --- |
| Protocol | Briven hosted Better Auth, per project |
| Browser key | `pk_briven_auth_…` from dashboard **Auth → API keys** (scopes: `read` \| `read-write` \| `admin`) |
| Server key | `brk_…` — never in client bundles |
| Session | Cookie; SDK uses `credentials: 'include'` |
| Client package | `@briven/auth` (+ `/react`, `/server`, `/svelte`, `/vue`) |
| API bridge | `https://api.briven.tech/v1/auth-tenant/*` + `x-briven-project-id` + `Authorization: Bearer <publicKey>` |
| Hosted UI | `auth.hostedPageURL(flow, callbackURL)` — flows include `sign-in`, `sign-up`, `two-factor`, … |
| 2FA | `signIn` may return `{ ok: true, twoFactorRequired: true }` → `twoFactor.verify` or `verifyBackupCode` |
| Testing | `auth.signIn.testToken('briven_test_…')` for e2e (admin-minted, short-lived) |
| JWT for backends | Project JWKS + short-lived JWT (docs “verify users with tokens”) |
| Rate limits | Per-project; Redis when `BRIVEN_REDIS_URL` set (`/ready` → `redis: ok`) |
| Password policy | Complexity + optional max age + force-reset (admin API) |
| Devices | New-device email on first UA fingerprint; admin can list/revoke sessions |

## Trusted setup path (do this order)

1. **Confirm project** — `briven.json` with `projectId` (`briven link` if missing).
2. **Human enables Auth** in dashboard.
3. **Human creates** `pk_briven_auth_…` (scope **`read-write`** for full sign-in). Agent never invents keys.
4. **Scaffold (Next.js):** `briven auth scaffold`  
   Writes `middleware.ts`, `lib/auth.ts`, env seeds, sign-in example.
5. **Install** `pnpm add @briven/auth` (optional react/vue/svelte subpaths).
6. **Wire client**

```ts
// lib/auth.ts
import { createBrivenAuth } from '@briven/auth';

export const auth = createBrivenAuth({
  projectId: process.env.NEXT_PUBLIC_BRIVEN_PROJECT_ID!,
  publicKey: process.env.NEXT_PUBLIC_BRIVEN_AUTH_KEY!, // pk_briven_auth_…
});
```

7. **UI**

```tsx
// Hosted (fastest pilot)
window.location.assign(auth.hostedPageURL('sign-in', '/dashboard'));

// Embedded React
import { BrivenAuthProvider, BrivenSignIn, TwoFactorChallenge, useSession } from '@briven/auth/react';
```

8. **Handle 2FA** after password:

```ts
const r = await auth.signIn.email({ email, password });
if (r.ok && 'twoFactorRequired' in r) {
  // show TwoFactorChallenge or hosted /auth/<id>/two-factor
}
if (r.ok && 'userId' in r) {
  // fully signed in
}
```

9. **Providers** — only enable in dashboard what the app shows (Google needs client id **and** secret).
10. **Verify** with `AUTH-GO-LIVE-CHECKLIST.md` (sign-up, wrong password, refresh, optional 2FA backup row 9b).

## MCP tools (read-only helpers)

- `auth_config_get` — what is enabled (no secrets in clear)
- `sender_domain_status` — email From domain / DNS status
- `auth_docs_ask` — plain-language auth Q&A (includes 2FA, test tokens, policy, scaffold)

**No** MCP write for full auth config. Do not invent off-platform auth.

## Env vars (canonical)

```bash
NEXT_PUBLIC_BRIVEN_API_ORIGIN=https://api.briven.tech
NEXT_PUBLIC_BRIVEN_PROJECT_ID=p_…
NEXT_PUBLIC_BRIVEN_AUTH_KEY=pk_briven_auth_…
BRIVEN_AUTH_PUBLIC_KEY=pk_briven_auth_…   # same value; middleware
# CI only:
# BRIVEN_AUTH_TEST_TOKEN=briven_test_…
```

## Framework notes

| Surface | Import |
| --- | --- |
| Vanilla | `@briven/auth` — `createBrivenAuth` |
| React | `@briven/auth/react` — `BrivenSignIn`, `useSession`, `useUser`, `useUserMetadata`, `useUserEmails`, `TwoFactorSetup`, `TwoFactorChallenge` |
| Vue | `@briven/auth/vue` — matching composables + sign-in panel |
| Svelte | `@briven/auth/svelte` — stores + helpers |
| Server (Next) | `@briven/auth/server` |

## Security red flags

- `brk_` or DB passwords in client / `NEXT_PUBLIC_*`
- Tokens in `localStorage` when cookies already work
- Logging email / full session / full keys
- Inventing OAuth secrets in repo instead of dashboard
- Client-only route guards for sensitive data
- Hand-rolling JWT verify ignoring JWKS docs
- Using testing tokens for real customers
- Calling wrong 2FA path (`/two-factor/verify` — use SDK `twoFactor.verify` → verify-totp)

## Pilot (minimum trustworthy demo)

1. Copy `examples/auth-pilot/` or run `briven auth scaffold`  
2. Email+password only  
3. Private page via `useSession()` / `getSession()`  
4. Owner runs checklist rows 0–4 + 7 (and 9b if 2FA is on)

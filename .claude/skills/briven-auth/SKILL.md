---
name: briven-auth
description: "Wire Briven end-user sign-in into a client app (@briven/auth, hosted pages, scaffold). Use when the user names Briven and wants login/signup/sessions — not admin brk_ API keys alone."
---

# Briven — User Authentication (agent playbook)

End-user auth for apps on Briven. Sessions are **httpOnly cookies** set by the Briven API. The browser-safe key is `pk_briven_auth_…` (not `brk_…`).

**Docs:** https://docs.briven.tech/auth  
**Manual go-live checklist (human):** `AUTH-GO-LIVE-CHECKLIST.md` in the Briven repo.

## When to use

- “Add Briven auth / login / sign-up to this app”
- Protect routes with a signed-in user
- Scaffold Next.js middleware proxy to Briven auth

## When NOT to use

- Only needs server-to-server data (`brk_` keys) → `briven-connect` / MCP data tools
- Briven project not created yet → `briven-setup`
- Third-party IdP with **no** Briven tenant in the middle

## Auth model (facts — not TODOs)

| Piece | Reality |
| --- | --- |
| Protocol | Briven hosted Better Auth, per project |
| Browser key | `pk_briven_auth_…` from dashboard **Auth → API keys** |
| Server key | `brk_…` — never in client bundles |
| Session | Cookie; SDK uses `credentials: 'include'` |
| Client package | `@briven/auth` (+ `/react`, `/server`, `/svelte`, `/vue`) |
| API bridge | `https://api.briven.tech/v1/auth-tenant/*` with `x-briven-project-id` + `Authorization: Bearer <publicKey>` |
| Hosted UI | `auth.hostedPageURL('sign-in' \| 'sign-up' \| …, callbackURL)` → `https://<projectId>.auth.briven.tech` |
| JWT for backends | Project JWKS + short-lived JWT (see docs “verify users with tokens”) |
| Rate limits | Redis when `BRIVEN_REDIS_URL` is set in prod (`/ready` → `redis: ok`) |

## Trusted setup path (do this order)

1. **Confirm project** — `briven.json` with `projectId` (`briven link` if missing).
2. **Human enables Auth** in dashboard (or confirm Auth pages already work).
3. **Human creates** `pk_briven_auth_…` (scope `read-write` for full sign-in). Agent never invents keys.
4. **Scaffold (Next.js):** from app root  
   `briven auth scaffold`  
   Writes `middleware.ts` (proxies `/api/auth/*` → Briven) and seeds `.env.local` if absent.
5. **Install SDK**  
   `pnpm add @briven/auth` (or npm/yarn).
6. **Wire client**

```ts
// lib/auth.ts
import { createBrivenAuth } from '@briven/auth';

export const auth = createBrivenAuth({
  projectId: process.env.NEXT_PUBLIC_BRIVEN_PROJECT_ID!,
  publicKey: process.env.NEXT_PUBLIC_BRIVEN_AUTH_KEY!, // pk_briven_auth_…
});
```

7. **UI** — either hosted redirect or embedded panel:

```tsx
// Hosted (fastest pilot)
window.location.assign(auth.hostedPageURL('sign-in', '/dashboard'));

// Or embedded React
import { BrivenAuthProvider, BrivenSignIn, useSession } from '@briven/auth/react';
```

8. **Providers** — only enable in dashboard what the app shows (Google needs client id **and** secret).
9. **Verify** against `AUTH-GO-LIVE-CHECKLIST.md` (sign-up, wrong password, refresh still signed in).

## MCP tools (read-only helpers)

On a project-bound Briven MCP server:

- `auth_config_get` — what is enabled (no secrets in clear)
- `sender_domain_status` — email From domain / DNS status
- `auth_docs_ask` — plain-language auth Q&A with docs citations

There is **no** MCP “write full auth config for me” — secrets and Enable Auth stay human/dashboard (or future write tools). Do not invent off-platform auth.

## Env vars (canonical)

```bash
NEXT_PUBLIC_BRIVEN_API_ORIGIN=https://api.briven.tech
NEXT_PUBLIC_BRIVEN_PROJECT_ID=p_…
NEXT_PUBLIC_BRIVEN_AUTH_KEY=pk_briven_auth_…
# middleware may also read BRIVEN_AUTH_PUBLIC_KEY — same value as the public key
```

## Output format when helping a user

```
### Briven auth in <framework>

#### 1. Prerequisites
- project id: …
- public key: present? (never paste full key)

#### 2. Install + scaffold
…

#### 3. Client snippet
…

#### 4. Sign-in UX (hosted vs BrivenSignIn)
…

#### 5. Protect a route
…

#### 6. Human checklist remaining
- [ ] AUTH-GO-LIVE-CHECKLIST rows …
```

## Security red flags

- `brk_` or database passwords in client code / `NEXT_PUBLIC_*`
- Tokens in `localStorage` when cookies already work
- Logging email / full session / full `pk_` keys
- Inventing OAuth client secrets in repo instead of dashboard
- Skipping server checks and relying only on client “if (user)” guards for sensitive data
- Hand-rolling JWT verify when docs already describe JWKS flow

## Pilot (minimum trustworthy demo)

1. One Next (or static + hosted pages) app  
2. Email+password only  
3. After login, show a private “you’re in” page that uses `getSession()` / `useSession()`  
4. Owner runs checklist sections 0–4 and 7  

That’s enough to call agents “setup helpers” for Auth — not a multi-tenant enterprise SSO rollout.

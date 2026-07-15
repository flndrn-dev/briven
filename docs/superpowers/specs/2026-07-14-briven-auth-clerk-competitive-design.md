# Briven Auth: Clerk-Competitive Authentication Design

## Problem

Every project that integrates `@briven/auth` hits the same wall: **Magic Link and OTP flows fail with `INVALID_ORIGIN` or redirect to the wrong place.** The root cause is not a bug in redirect normalization — that was fixed in commits `9ef63de` and `df0db90`. The root cause is that Briven Auth forces every customer app to **manually bridge two origins**:

1. The auth API runs on `api.briven.tech`.
2. The customer's app runs on `localhost:3001`, `murphus.eu`, etc.

Better Auth's `originCheck` rejects requests from origins that are not explicitly allow-listed. Other agents set up the SDK and proxy correctly, but they do not know they must also open the Briven dashboard, navigate to Auth → Allowed Domains, and add every local + production origin. The error message `INVALID_ORIGIN` tells them *that* something is wrong, but not *what* to configure.

This is the opposite of Clerk or Supabase Auth, where local development "just works" after pasting a publishable key.

## Current state

Briven already has the pieces for a Clerk-style experience, but they are not wired together as the default path:

- **Hosted auth pages** exist at `apps/web/src/app/(hosted)/auth/[projectId]/[flow]/hosted-flow.tsx`. They currently support `sign-in`, `sign-up`, `magic-link`, and `otp`.
- **Subdomain hosting** is partially supported: `hostedAuthBaseUrl()` returns `https://<projectId>.auth.briven.tech` in production.
- **The SDK** (`@briven/auth`) defaults to making cross-origin calls directly to `api.briven.tech/v1/auth-tenant/*`.
- **The bridge** (`apps/api/src/routes/auth-service.ts`) normalizes `redirectTo` → `callbackURL` and absolutizes relative paths, but only for JSON POSTs.
- **Allowed domains** are managed per-project via `/v1/projects/:id/auth/allowed-domains` and stored in `auth-origin-allowlist.ts`.

## How Clerk and Supabase solve this

### Clerk

- The customer adds a **publishable key** and a **secret key** to their app. No per-origin allow-list is required for development.
- Clerk components (`<SignIn />`, `<UserButton />`) embed directly in the customer's app and talk to Clerk's API using a **dev-browser token** stored in `localStorage` plus first-party cookies where possible.
- For OAuth and magic links, Clerk uses its own hosted domain (`accounts.clerk.dev`) as a trusted intermediary, then redirects back to the customer's `afterSignInUrl`.
- The customer's app never has to think about CORS or origin allow-lists because Clerk's SDK owns the handshake.

### Supabase Auth

- The customer configures a **Site URL** and optional **Redirect URLs** in the dashboard.
- Auth can happen server-side via SSR helpers that set cookies on the customer's own domain, or via the Supabase-hosted auth UI.
- Localhost is typically added manually as a redirect URL, but the SSR path avoids most cross-origin friction because the cookie lives on the app's domain.

### What Briven is missing

1. **No automatic localhost allowance.** Every new project starts with an empty origin list, so `localhost:3001` is rejected immediately.
2. **The SDK uses cross-origin API calls as the default.** This exposes Better Auth's `originCheck` directly to the customer's app origin.
3. **No clear path from `INVALID_ORIGIN` to the fix.** The error is a raw Better Auth error.
4. **Hosted pages exist but are not the default.** The SDK's `signIn.email()`, `magicLink()`, etc. call the API directly instead of redirecting to the hosted page.
5. **No customer-owned auth subdomain.** `auth.murphus.eu` is not provisioned; auth either happens cross-origin on `api.briven.tech` or on `p_xxx.auth.briven.tech`.

## Proposed solution

Move Briven Auth to a **hosted-pages-first, subdomain-based model** with automatic localhost support and actionable errors. The customer app stops making cross-origin auth API calls and instead redirects to a Briven-hosted auth page.

### Project-side proxy/middleware file (Clerk-style)

Just as Clerk requires the customer to add a `middleware.ts` file to their Next.js app, Briven Auth should require a small, documented project-side proxy. This file is not optional friction — it is the boundary where the customer's app origin meets Briven's auth API. The proxy has two jobs:

1. **Forward auth requests** from `/api/auth/*` to Briven's tenant auth bridge, injecting the project id and public key.
2. **Attach the app's real Origin header** so Briven can validate the request and absolutize relative `callbackURL` values correctly.

Example `middleware.ts` for a Next.js customer app:

```ts
import { NextResponse, type NextRequest } from 'next/server';

const BRIVEN_API_ORIGIN = process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? 'https://api.briven.tech';
const BRIVEN_PROJECT_ID = process.env.NEXT_PUBLIC_BRIVEN_PROJECT_ID!;
const BRIVEN_AUTH_KEY = process.env.BRIVEN_AUTH_PUBLIC_KEY!;

export async function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith('/api/auth/')) return NextResponse.next();

  const url = new URL(req.nextUrl.pathname.replace('/api/auth', '/v1/auth-tenant'), BRIVEN_API_ORIGIN);
  url.search = req.nextUrl.search;

  const headers = new Headers(req.headers);
  headers.set('x-briven-project-id', BRIVEN_PROJECT_ID);
  headers.set('authorization', `Bearer ${BRIVEN_AUTH_KEY}`);

  return fetch(url, {
    method: req.method,
    headers,
    body: req.body,
    // @ts-expect-error — duplex is required for streaming request bodies in Node 18+
    duplex: 'half',
  });
}

export const config = {
  matcher: ['/api/auth/:path*'],
};
```

This is the exact pattern Murphus and other projects already use. The difference from Clerk is that Clerk's middleware is generated/installed by the CLI and its origins are auto-allowed. Briven must do the same: **document the file, provide a CLI command to generate it, and auto-allow common dev origins so the proxy works immediately.**

### High-level flow (covers all sign-in methods)

The same pattern applies to **email+password, magic link, email OTP, and social OAuth**:

1. Customer app calls `auth.signIn.magicLink({ email, redirectTo: '/dashboard' })` or `auth.signIn.social({ provider: 'google', redirectTo: '/dashboard' })`.
2. The SDK builds a URL like:
   ```
   https://auth.murphus.eu/magic-link?callbackURL=https://murphus.eu/dashboard&projectId=p_xxx
   ```
   For local development this falls back to:
   ```
   https://p_xxx.auth.briven.tech/magic-link?callbackURL=http://localhost:3001/dashboard
   ```
3. For **OAuth**, the hosted page redirects to the provider (Google, GitHub, etc.) with its own callback set to the hosted subdomain. The provider callback lands back on the hosted page, which then redirects to the customer's app.
4. The user enters their email on the Briven-hosted page (password, magic link, or OTP). The page is **same-origin** with the auth API, so `originCheck` passes without any customer configuration.
5. The magic link is sent. The link points back to the same hosted auth subdomain.
6. After verification, the hosted page sets the session cookie and redirects to `https://murphus.eu/dashboard`.

### Architectural changes

#### 1. Auto-allow localhost in non-production

When `BRIVEN_ENV !== 'production'`, `createAuthInstance` in `apps/api/src/services/auth-tenant-pool.ts` automatically adds wildcard localhost origins to `trustedOrigins`:

```ts
const devOrigins = env.BRIVEN_ENV !== 'production'
  ? ['http://localhost:*', 'https://localhost:*', 'http://127.0.0.1:*', 'https://127.0.0.1:*']
  : [];
```

This preserves strict production security while removing the #1 source of agent confusion.

#### 2. Actionable `INVALID_ORIGIN` error

Add a lightweight response wrapper in the tenant-auth bridge (`apps/api/src/routes/auth-service.ts`). When Better Auth returns `INVALID_ORIGIN`, replace it with:

```json
{
  "code": "INVALID_ORIGIN",
  "message": "Origin http://localhost:3001 is not allowed for this project. Add it in the Briven dashboard → Auth → Allowed Domains, or via POST /v1/projects/:id/auth/allowed-domains.",
  "docs": "https://docs.briven.tech/auth/allowed-domains"
}
```

This is the safety net for production custom domains that are not auto-allowed.

#### 3. Customer auth subdomain

Introduce `auth.<customer-domain>` as the hosted-pages target:

- In the project auth config, store a `customAuthDomain` (e.g., `auth.murphus.eu`).
- Provide an endpoint or dashboard flow that validates the DNS record and provisions the subdomain.
- The web app's `proxy.ts` already supports subdomain routing (`admin.<domain>`); extend it to recognize `auth.<domain>` and serve the hosted auth pages group.
- `hostedAuthBaseUrl()` chooses:
  - `https://<customAuthDomain>` if configured,
  - else `https://<projectId>.auth.briven.tech` in production,
  - else `env.BRIVEN_API_ORIGIN` in dev.

#### 4. SDK becomes redirect-first

Update `@briven/auth` so that the default behavior is to redirect to the hosted page rather than call the API cross-origin:

- `signIn.email()` → redirect to hosted sign-in page with `callbackURL`.
- `signIn.magicLink()` → redirect to hosted magic-link page.
- `signIn.otpRequest()` → redirect to hosted OTP page.
- `signIn.social()` → redirect to hosted OAuth page. The hosted page initiates the OAuth handshake using a callback on the hosted subdomain, then redirects back to the customer's app. This prevents the customer's `localhost:3001/api/auth/callback/google` from being rejected as an untrusted origin.
- Keep the direct API calls available via an opt-in flag for advanced users who want to build fully custom UI and have already configured origins.

The SDK should also auto-register / warn about missing allowed domains by calling a new lightweight endpoint before redirecting.

#### 5. Session cookie domain strategy

For the subdomain model to work, the session cookie set on `auth.murphus.eu` must be readable by `murphus.eu`. Options:

- **Parent-domain cookie**: Set the cookie with `Domain=.murphus.eu`. Works for subdomains but not for `p_xxx.auth.briven.tech` (cookie would be on `.auth.briven.tech`, shared across tenants — bad).
- **Token-in-URL + app-side validation**: After auth, redirect to `https://murphus.eu/dashboard?briven_session=<jwt>`. The app exchanges it for a cookie on its own domain via a server-side endpoint. This avoids cross-subdomain cookie sharing but requires a server-side helper.
- **Clerk-style dev browser**: Keep a long-lived token in `localStorage` and make cross-origin session checks. More complex but works on any domain.

Recommended: **Parent-domain cookie for custom auth subdomains** + **token-in-URL exchange for shared `auth.briven.tech` subdomains**.

### Implementation phases

#### Phase 0: Immediate pain relief (this session)

- Implement auto-allow localhost in non-production.
- Implement actionable `INVALID_ORIGIN` error message.
- Add the Murphus `localhost:3001` origin manually if not already present.

#### Phase 1: Hosted-pages-first SDK + project middleware

- Add `redirectTo` handling in hosted pages for all flows.
- Update `@briven/auth` to default to redirecting to hosted pages.
- Keep direct API calls behind an `advanced: true` option.
- Provide a CLI command or SDK helper that scaffolds the project's `middleware.ts` / `proxy.ts` file with the correct env vars and matcher.

#### Phase 2: Custom auth subdomain

- Add `customAuthDomain` to auth config.
- Build DNS validation endpoint.
- Extend web app `proxy.ts` to route `auth.<domain>` to hosted pages.
- Implement parent-domain cookie strategy for custom domains.

#### Phase 3: Embedded components (future)

- Provide React/Vue components that handle auth inline, Clerk-style.
- This is the longest-term path and may not be necessary if Phases 0–2 solve the friction.

## Why this beats the current model

| Friction | Current model | Proposed model |
|---|---|---|
| `localhost:3001` rejected | Must manually add to dashboard every project | Auto-allowed in dev |
| `INVALID_ORIGIN` error | Raw Better Auth error | Actionable message with exact fix |
| Magic link / OTP setup | SDK + proxy + allowed domains + debugging | Redirect to hosted page, works out of the box |
| Custom domain production | Must add exact origin in dashboard | Use `auth.murphus.eu`, no origin list needed |
| Competitive comparison | Not comparable to Clerk/Supabase | Comparable hosted-pages experience |

## Security notes

- Auto-allowing `localhost:*` in non-production does not weaken production.
- The parent-domain cookie strategy only applies to customer-owned domains, not shared `auth.briven.tech`.
- `trustedOrigins` in production still requires explicit allow-listing; the actionable error tells users how.
- OAuth callbacks and magic-link tokens remain one-time and short-lived.

## Success criteria

- A new project can run `npm create briven-app`, paste a project ID and public key, and have Magic Link + OTP working on `localhost:3001` without touching the dashboard.
- A production project on a custom domain can configure `auth.murphus.eu` and have auth work without adding `murphus.eu` to an origin allow-list.
- The `INVALID_ORIGIN` error never appears without a clear next-step message.

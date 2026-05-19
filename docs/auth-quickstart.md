# briven auth — quickstart

> **Target:** sign-in working in a fresh Next.js 16 project in ≤ 5 minutes
> (`BUILD_PLAN.md` §14 acceptance gate).
>
> **Prerequisites:** an existing briven project (you've shipped `briven deploy`
> at least once) and access to the dashboard.

---

## 1. Enable auth on your project (1 minute)

```text
Dashboard → projects → <your project> → auth → enable auth
```

This runs a single idempotent migration that provisions five tables in
your project's data-plane schema:

```text
_briven_auth_users
_briven_auth_sessions
_briven_auth_accounts
_briven_auth_verification_tokens
_briven_auth_audit_log
```

After this finishes, every authenticated end-user is a row you can JOIN
against — `SELECT u.id, p.title FROM _briven_auth_users u JOIN posts p ON
p.author_id = u.id` — without sync, shadow tables, or webhooks.

## 2. Configure providers (1 minute)

```text
auth → providers
```

Toggle on what you want: `email + password`, `magic link`, `email OTP`,
`passkey`, and any of the four OAuth providers (`google`, `github`,
`discord`, `microsoft`). OAuth requires pasting the client id and secret
from the provider's dashboard. Secrets are encrypted at rest with a
per-tenant key derived via HKDF — even the platform operator can't read
them across tenants.

## 3. Mint an SDK key (30 seconds)

```text
auth → api keys → create key
```

Name it `dev local`, scope `read-write`. Copy the plaintext immediately —
the dashboard will not show it again. Only its sha-256 digest persists.

## 4. Install the SDK (30 seconds)

```bash
pnpm add @briven/auth
```

Peer deps `react` and `react-dom` are optional — needed only when you
import from `@briven/auth/react`.

## 5. Wire it up (2 minutes)

### 5a. Initialise the client

```ts
// lib/auth.ts
import { createBrivenAuth } from '@briven/auth';

export const auth = createBrivenAuth({
  projectId: 'p_abc123',                  // from the dashboard URL
  publicKey: process.env.BRIVEN_AUTH_PUBLIC_KEY!,  // from step 3
});
```

### 5b. Wrap the app

```tsx
// app/providers.tsx
'use client';

import { BrivenAuthProvider } from '@briven/auth/react';
import { auth } from '@/lib/auth';

export function Providers({ children }: { children: React.ReactNode }) {
  return <BrivenAuthProvider value={auth}>{children}</BrivenAuthProvider>;
}
```

```tsx
// app/layout.tsx
import { Providers } from './providers';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
```

### 5c. Drop in the sign-in component

```tsx
// app/sign-in/page.tsx
'use client';

import { BrivenSignIn } from '@briven/auth/react';

export default function SignInPage() {
  return <BrivenSignIn redirectTo="/dashboard" />;
}
```

Done. Visit `/sign-in`, click `continue with google`, complete the OAuth
flow, land at `/dashboard`. Inspect your `_briven_auth_users` table from
the studio — your user is a row.

## 6. Read the session server-side

```tsx
// app/dashboard/page.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getServerSession } from '@briven/auth/server';
import { auth } from '@/lib/auth';

export default async function Dashboard() {
  const cookieHeader = (await cookies()).toString();
  const session = await getServerSession(auth, { cookieHeader });
  if (!session?.authenticated) redirect('/sign-in');
  return <main>welcome, user {session.userId}</main>;
}
```

## 7. Read the session client-side

```tsx
'use client';

import { useSession, useUser } from '@briven/auth/react';

export function UserChip() {
  const { session, isLoading } = useSession();
  const { user } = useUser();
  if (isLoading) return null;
  if (!session?.authenticated) return null;
  return <span>{user?.name ?? user?.email}</span>;
}
```

## 8. Sign out

```tsx
import { useBrivenAuth } from '@briven/auth/react';

export function SignOut() {
  const auth = useBrivenAuth();
  return (
    <button onClick={() => void auth.signOut()}>
      sign out
    </button>
  );
}
```

---

## Hosted pages (no app code path)

If you'd rather not embed the SDK at all, point users at
`https://<your-project-id>.auth.briven.tech/sign-in` (or
`https://briven.tech/auth/<projectId>/sign-in` before the subdomain split
lands). Five flows pre-built:

| Path | Flow |
| --- | --- |
| `/sign-in` | email + password + 4 OAuth providers |
| `/sign-up` | new account |
| `/magic-link` | one-shot email link |
| `/otp` | 6-digit email code |
| `/account` | authenticated landing — sessions + sign-out |

Hosted pages set a cookie on `briven.tech`. To use them with your custom
domain (`login.yourapp.com`), see the **Custom domain** section.

## Custom domain (`login.yourapp.com`)

```text
auth → branding → custom domain
```

Add a CNAME record at your DNS host:

```text
login.yourapp.com  CNAME  <your-project-id>.auth.briven.tech.
```

briven's traefik proxy provisions a Let's Encrypt certificate on first
request. Propagation typically completes within 10 minutes of the CNAME
landing.

## Webhooks

```text
auth → webhooks → create auth webhook
```

Subscribe to any combination of `auth.signup`, `auth.signin`,
`auth.signout`, `auth.session.revoked`, `auth.account.linked`,
`auth.account.unlinked`, `auth.user.deleted`. briven POSTs a signed
payload to your endpoint; verify with HMAC-SHA256 over `${ts}.${rawBody}`
and compare to the `X-Briven-Signature` header.

The signing secret is shown exactly once at creation — rotate it via the
dashboard if you suspect a leak.

## Privacy boundaries

You can do whatever you like with the user's data inside your project
schema — it's your database. But on the dashboard and in briven-emitted
logs you'll only ever see redacted shapes:

- emails appear as `•••@domain.tld` in any list view
- names appear as `J•••` (first character only)
- IPs are stored as sha-256 digests, never raw

This is enforced at the api layer; you can't accidentally surface the
raw values in a screenshot to an operator.

## Pricing + plan limits

MAU = distinct users with at least one session in the trailing 30 days.

| Plan | MAU ceiling | Overage |
| --- | --- | --- |
| free | 1,000 | hard-capped — new sign-ups blocked at the ceiling |
| pro | 25,000 | metered, billed via Polar |
| team | 250,000 | metered, billed via Polar |

Live count lives at `dashboard → auth → usage`.

## Troubleshooting

**`projectId required` on every SDK call** — `BRIVEN_AUTH_PUBLIC_KEY` is
unset in your app's env. Re-check step 3 + step 5a.

**Sign-in lands on `unauthenticated`** — cookie domain mismatch. If
you're serving the SDK and the api from different origins, cookies are
blocked by the browser. Either deploy both on `*.yourapp.com` or use the
hosted pages (which run on `briven.tech` and avoid the issue entirely).

**OAuth `state` mismatch** — your OAuth provider's redirect URI is wrong.
It should be `https://api.briven.tech/v1/auth-tenant/oauth/<provider>/callback`
(not your app's URL). Update in the provider's dashboard.

**Magic link doesn't arrive** — sender-domain verification incomplete.
`auth → branding → sender domain` — finish the SPF + DKIM cycle.

## Next steps

- Read the [djstudio migration runbook](./runbooks/auth-djstudio-migration.md)
  if you're moving off Better Auth.
- Read the [pen-test harness](../apps/api/src/services/auth-tenant-isolation.test.ts)
  if you're integrating in a regulated environment and want to see the
  isolation guarantees verified.

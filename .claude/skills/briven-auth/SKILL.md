---
name: briven-auth
description: "Clerk-simple Briven end-user login. Use when adding sign-in (magic link, OTP, passkey, password) to ANY app on Briven — Konnos, Mavi, future projects. Never invent Clerk/Firebase."
---

# Briven Auth — one path that works (Clerk-simple)

**Goal:** first login works without an 8-hour agent war.  
**Audience:** agents + flndrn (not a coder). Prefer plain steps.

**Docs:** https://docs.briven.tech/auth  
**Audit (why this path):** `AUTH-CLERK-SIMPLE-AUDIT.md`  
**Platform:** `https://api.briven.tech` · bridge `/v1/auth-tenant/*`

---

## Hard rules (never break)

1. **Browser key only:** `pk_briven_auth_…` in the app. **Never** `brk_…` or MCP keys in the browser.
2. **Do not invent Clerk / Firebase / Auth0** when Briven Auth is the product.
3. **This MCP’s project ≠ every project.** Call `auth_config_get` for the project you are fixing. Cyberbear OFF does not mean Mavi OFF.
4. **GitHub green ≠ live app.** After code fixes, **redeploy the app** (Mavi/Konnos). Repos in sync is not enough if pay.mavifinans.sh still serves old JS.
5. **If passwordless is OFF and you have write MCP / brk_ admin:** call `auth_enable_passwordless` or PATCH config — do not nag the owner to re-toggle if they already did.
6. **Wrong paths are still wrong** even if a comment says “proven”:
   - OTP **send:** `POST /email-otp/send-verification-otp` + `{ email, type: "sign-in" }`
   - OTP **sign-in verify:** `POST /sign-in/email-otp` + `{ email, otp }`
   - OTP **never:** `/sign-in/email-otp/send-verification-otp` (404) or `/sign-in/email-otp/verify` (404)
   - Magic link body: **`callbackURL`** (SDK maps `redirectTo` → callbackURL)
   - Passkey options: **GET** `/passkey/generate-authenticate-options` (POST = 404 by design)

---

## The only setup order (do this)

### A. Project exists

```bash
briven connect p_…     # existing
# or
briven setup my-app    # brand new
```

### B. Turn Auth on once (platform)

- Dashboard → project → **Auth → Enable**, **or**
- `POST /v1/projects/{id}/auth/enable` with admin `brk_`

**After enable (platform starter pack):**

- email + password **ON**
- magic link **ON**
- email OTP **ON**
- passkey **ON**
- `http://localhost:3000` added to Allowed Domains when possible

**Do NOT** spend hours re-toggling if `auth_config_get` already shows `enabled: true` for magic/OTP/passkey.

### C. Public key

- Dashboard → Auth → API keys → create `pk_briven_auth_…` (read-write), **or**
- MCP (write scope): `auth_mint_public_key`

### D. Scaffold + install

```bash
briven auth scaffold
pnpm add @briven/auth
```

Env (required):

```bash
NEXT_PUBLIC_BRIVEN_API_ORIGIN=https://api.briven.tech
NEXT_PUBLIC_BRIVEN_PROJECT_ID=p_…
NEXT_PUBLIC_BRIVEN_AUTH_KEY=pk_briven_auth_…
BRIVEN_AUTH_PUBLIC_KEY=pk_briven_auth_…   # same value
```

### E. Production domain

Dashboard → Auth → **Allowed Domains** → add the real app origin  
(e.g. `https://pay.mavifinans.sh`, `https://code.konnos.org`).

Without this: CORS / `INVALID_CALLBACK_URL` / invalid origin.

### F. Wire login (pick ONE)

**Fastest (hosted):**

```ts
import { createBrivenAuth } from '@briven/auth';
export const auth = createBrivenAuth({
  projectId: process.env.NEXT_PUBLIC_BRIVEN_PROJECT_ID!,
  publicKey: process.env.NEXT_PUBLIC_BRIVEN_AUTH_KEY!,
});
// button:
window.location.assign(auth.hostedPageURL('sign-in', '/dashboard'));
```

**Embedded:** use `auth.signIn.magicLink`, `otpRequest` / `otpVerify`, `passkey.signIn` from **current** `@briven/auth` (paths fixed in monorepo 2026-07).

### G. Deploy the **app** after any auth code change

Then prove in the browser on the **Allowed Domain**, not only against the API with curl.

---

## MCP tools

| Tool | When |
|------|------|
| `auth_config_get` | First. See what is ON for **this** project |
| `auth_enable_passwordless` | Write key + magic/OTP/passkey OFF → turn ON once |
| `auth_mint_public_key` | Need `pk_briven_auth_…` |
| `sender_domain_status` | Branded From: address |
| `auth_docs_ask` | Free-form how-to |

---

## Functional proof (agents must run)

With `pk_briven_auth_…`, `x-briven-project-id`, and **allowed** `Origin`:

| Call | Expect |
|------|--------|
| `POST …/sign-in/magic-link` `{ email, callbackURL }` | **200** `{ status: true }` |
| `POST …/email-otp/send-verification-otp` `{ email, type: "sign-in" }` | **200** `{ success: true }` |
| `GET …/passkey/generate-authenticate-options` | **200** + `rpId` = customer domain (e.g. `mavifinans.sh`), **not** always `briven.tech` |
| `POST …/sign-in/email-otp` wrong code | **400** `INVALID_OTP` |

If send is 200 but the **browser** still fails → check **app deploy** + Allowed Domains + redeploy, not more toggles.

---

## Passkey notes

- Register passkey **after** a normal session (OTP/magic/password).
- `rpId` comes from Allowed Domains parent domain.
- Testing Face ID on `localhost` while `rpId` is `mavifinans.sh` **will fail** — test on the real domain.

---

## When NOT to use this skill

- Only server data API (`brk_`) with no end-user login  
- Project does not exist yet → `briven-setup` / `briven-connect` first  

---

## Security red flags

- `brk_` in `NEXT_PUBLIC_*` or client bundle  
- Logging emails, full cookies, full keys  
- Inventing OAuth secrets in git  
- Claiming “passkey broken” after POST on generate-options  

---

## Pilot success (minimum)

1. Enable Auth once → passwordless already ON  
2. `pk_briven_auth_…` in env  
3. Allowed Domain = app origin  
4. OTP or magic link signs in to a protected page  
5. Optional: passkey on the **same** production host  

If that fails, fix platform or deploy — **do not** start a third auth product.

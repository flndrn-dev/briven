# SuperTokens vs Briven Auth — honest comparison

**Date:** 2026-07-21  
**For:** flndrn (plain language)  
**Sources:** SuperTokens core README + product docs; Briven monorepo Auth surface as of Konnos `main`.

---

## What you asked

Use SuperTokens ([supertokens-core](https://github.com/supertokens/supertokens-core), [docs](https://supertokens.com/docs/authentication/overview)) as the **reference base** for how Briven Auth should feel: simple, reliable, one-go setup — and list gaps + what to build.

---

## SuperTokens in one picture (how it is built)

SuperTokens is **three boxes**, not one:

| Box | What it is | Everyday analogy |
|-----|------------|------------------|
| **1. Frontend SDK** | Login UI + automatic session handling in the browser | The shop front + door lock on the customer’s phone |
| **2. Backend SDK** | Auth APIs on **your** server domain (`/auth/*` on your API) | Your shop’s own counter — customers never talk to the vault directly |
| **3. SuperTokens Core** | Separate HTTP service (Java) + **your** database for users/sessions | The vault in the back room — all real rules live here |

**Critical SuperTokens design choices:**

1. **Browser talks to YOUR domain**, not a third-party “auth.com” page for normal flows.  
2. **Core is a real product**: recipes (email-password, passwordless, third-party, MFA, multi-tenant, roles) are versioned and tested together.  
3. **Sessions are first-class**: access + refresh, rotation, anti-CSRF, revoke, multi-device — not “cookie happened to stick.”  
4. **Config is code + core**, not a flaky dashboard toggle that may not apply.  
5. **Multi-tenant is designed in** (`appId` / `tenantId`), not bolted on later.  
6. **Prebuilt UI** that works out of the box; every piece overridable.  
7. Self-host or managed cloud; open-core (Apache 2 + commercial EE bits).

---

## Briven Auth in one picture (how it is built today)

| Box | What it is | Everyday analogy |
|-----|------------|------------------|
| **1. `@briven/auth` (frontend)** | Thin client; optional React/Vue UI pieces | A remote control — only works if the TV is on the right channel |
| **2. Briven API** (`/v1/auth-tenant/*`) | Hosted Better Auth per project on `api.briven.tech` | One shared TV station for every tenant |
| **3. Per-project Doltgres tables** | Users/sessions inside each project DB | Each customer’s folder in a big filing cabinet |
| **4. Dashboard** | Enable Auth, providers, keys, allowed domains | Wall switches — if a switch doesn’t stick, the room stays dark |

**Critical Briven design choices today:**

1. Apps often call **api.briven.tech** directly (cross-site cookies) unless they add a **first-party proxy**.  
2. Engine is **Better Auth** embedded in the Briven API, not a standalone “auth core” service.  
3. Tenancy = **one Better Auth instance + one project DB** (good isolation), configured via JSON config + dashboard.  
4. Sessions = Better Auth cookies; Safari/third-party pain unless proxy (Konnos pattern).  
5. Providers toggles + secrets + allowed domains + keys = **many steps**, easy to desync from the live app.  
6. Magic-link host / OTP paths / passkey `rpId` have been real production bugs (partially fixed in code; deploy lag still bites).

---

## Side-by-side comparison

| Topic | SuperTokens | Briven Auth (today) | Gap size |
|-------|-------------|---------------------|----------|
| **Architecture** | Frontend SDK + Backend SDK + **Core service** | Frontend SDK + **hosted API** (no separate core process) | Large |
| **Where login APIs live** | **Same domain as your app** (via backend SDK) | Default: **api.briven.tech** (proxy optional) | Large |
| **Cookie / session reliability** | Designed first-party; refresh rotation | Works when proxy + SameSite set right; fragile without | Large |
| **Email + password** | Recipe, battle-tested | Supported (Better Auth) | Small |
| **Magic link** | Recipe; app-domain friendly | Exists; link host / callback / deploy lag pain | Medium–Large |
| **Email / SMS OTP** | Recipe (email + phone) | Email OTP exists; SMS not productized | Medium |
| **Social login** | Recipe; clear config | Many providers in config; secrets + client id required | Medium |
| **Passkeys / WebAuthn** | Supported in modern MFA stack | Supported; `rpId` must match app domain | Medium |
| **MFA (TOTP / backup)** | First-class recipe | Present (2FA plugins / UI pieces) | Small–Medium |
| **Session management** | Core product (list/revoke/rotate/limits) | Sessions exist; admin UX thinner | Medium |
| **User admin dashboard** | Built-in user management UI | Briven dashboard Auth section (users/config) | Medium |
| **Multi-tenant / orgs / SSO** | Designed recipes | Project isolation yes; B2B org/SSO partial | Large |
| **Roles / permissions** | Recipe | Orgs/roles exist in places; not “one recipe” | Medium |
| **Setup time (ideal)** | Minutes with SDK + core | Should be minutes; often **days** in practice | **Product gap** |
| **“Save providers” reliability** | Config applied through SDK/core path | Dashboard save **feels broken** to you across projects | **Critical UX gap** |
| **Deploy / version sync** | Core version + SDK versions pinned | App JS can lag platform (repo ≠ live) | Large ops gap |
| **Self-host auth engine** | Yes (Core + DB) | Auth is **inside** Briven platform (hosted) | Different model |
| **Open source “base”** | SuperTokens Core is the base | Better Auth is the base | Different stack |
| **Vendor lock-out** | Strong “own your DB” story | Data in project Doltgres; still Briven-shaped | Medium |

---

## Why your projects still feel broken (honest)

These are **not** “you forgot to click save” stories only:

1. **Platform vs app lag** — Auth fixed in monorepo; live API or app bundle still old.  
2. **Cross-site sessions** — Without `/api/auth/…` proxy on the app, magic link / cookies feel random.  
3. **Provider save perception** — Either UI doesn’t persist, doesn’t invalidate the live auth instance, or agents read a **different project** than the one you saved. Needs a hard proof path (save → reload → API GET → login probe).  
4. **Too many knobs** — Enable + providers + secrets + domains + keys + correct SDK paths. SuperTokens collapses this into “init recipes + core.”  
5. **Magic link URL** — Must land on **project URL** (proxy), not a bare API JSON page (fix in code; needs live deploy + app proxy).

---

## What “like SuperTokens” means for Briven (target product)

A SuperTokens-like Briven Auth would feel like this for every project:

1. **One switch:** Auth ON for project.  
2. **One key:** `pk_briven_auth_…` (or automatic mint on scaffold).  
3. **One domain row:** your app origin (auto-seeded from first request if possible).  
4. **Login methods that stay on** when you save (and live instance reloads).  
5. **App always uses first-party proxy** so email links and cookies are on **your** host.  
6. **Prebuilt sign-in** that just works; custom UI optional.  
7. **Session tools**: list devices, revoke, refresh, without reinventing paths.  
8. **Version pin**: dashboard shows “Auth engine build X”; apps cannot silently run broken old JS.

---

## Two strategic options (pick one later)

### Option A — **Adopt SuperTokens as the engine** (true “borrow the base”)

**Idea:** Run SuperTokens Core (self-hosted on Briven infra), multi-tenant map `projectId` → SuperTokens `tenantId`/`appId`, expose Briven-branded APIs + dashboard, ship `@briven/auth` as a thin SuperTokens frontend/backend wrapper.

| Pros | Cons |
|------|------|
| Proven recipes, sessions, multi-tenant | Big migration off Better Auth |
| Clear open-source base you pointed at | Ops: Core (Java) + DB + upgrades |
| Faster path to “works like SuperTokens” | Existing tenants need migration plan |
| | Product still needs Briven multi-project UX |

**Rough work:** 4–12+ weeks for solid multi-tenant hosted wrapper + migration path (not a weekend).

### Option B — **Keep Better Auth, copy SuperTokens architecture** (pattern borrow)

**Idea:** Do not run SuperTokens Core. Instead force Briven to behave like SuperTokens’ **three-layer contract**:

1. **Mandatory first-party auth proxy** in every scaffold (no direct browser → api.briven.tech for login).  
2. **Single “Auth recipe pack”** (email + magic + OTP + passkey) applied on Enable and **re-applied on every Save** with proof response.  
3. **Invalidate + re-probe** after every dashboard save (fix the “never saves” bug with tests).  
4. **Magic/verify links only on app origin.**  
5. **Session APIs** documented and UI’d like SuperTokens (list/revoke).  
6. **Live version badge** on dashboard + app doctor.

| Pros | Cons |
|------|------|
| Smaller rewrite | You still maintain Better Auth edge cases |
| Keeps Doltgres-per-project model | Won’t equal SuperTokens multi-tenant depth soon |
| Fixes the pain you feel fastest | |

**Rough work:** days–few weeks for the critical path if deploy discipline holds.

---

## Gap-closing backlog (ordered by pain)

### P0 — “Save providers + login works once” (must close first)

1. **Prove & fix Providers Save**  
   - Instrument dashboard Save → PATCH `/auth/config` → response body → reload GET.  
   - On success: `invalidateAuthInstance` (already) + show “live: magic ON/OFF” from GET not from local UI state.  
   - E2E test: toggle magic → save → logout UI → GET still true → magic send 200.  
2. **Deploy France to latest Konnos** so defaults + magic-link-to-app-URL + OTP path fixes are live.  
3. **Force every app scaffold** to include first-party proxy; refuse “direct API only” as recommended path.  
4. **Redeploy each app** (Mavi, Konnos, …) after platform fix — repo green ≠ browser green.

### P1 — SuperTokens-like DX

5. One command: `briven auth setup` = enable + starter pack + mint key + write env + proxy + sample login.  
6. Hosted prebuilt UI that uses proxy only.  
7. Session management panel (devices / revoke).  
8. Publish pinned `@briven/auth` version apps must use (no ancient npm path bugs).

### P2 — SuperTokens-like product depth

9. Phone OTP / SMS recipe.  
10. Stronger multi-tenant org/SSO story (or map SuperTokens multi-tenancy if Option A).  
11. Roles/permissions recipe polish.  
12. Migration tools if Option A.

---

## Recommendation (honest)

- **If the goal is “auth like SuperTokens” as a product category:**  
  **Option A** (run SuperTokens Core under Briven’s multi-project roof) is the real “borrow the base,” same spirit as forking solid open source elsewhere.  
- **If the goal is “stop the two-day pain this week”:**  
  **Option B P0** first (save reliability + live deploy + mandatory proxy + app redeploys). Without that, even SuperTokens would feel broken if the dashboard lie and deploys lag.

You do **not** need to throw Briven away tomorrow — but you **do** need to choose: **wrap SuperTokens**, or **make Better Auth behave like SuperTokens’ architecture**. Half-doing both will keep the pain.

---

## Success definition (SuperTokens bar)

> For a **new** Briven project: enable Auth → pick methods → save → open app login → magic or OTP works **same day**, link opens on **project URL**, session survives refresh, without agents debugging paths.

Until that is true on **live** for Mavi/Konnos/etc., the SuperTokens gap is **not** closed — regardless of how many switches look green.

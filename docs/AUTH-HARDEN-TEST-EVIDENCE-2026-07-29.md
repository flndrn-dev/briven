# AUTH-HARDEN-90 test evidence — 2026-07-29

**Sprint:** AUTH-HARDEN-90 test phase (T1–T8)  
**Engine:** briven-engine / Doltgres · FDI `/v1/auth-core/fdi/*`  
**SuperTokens map:** KB `docs/knowledge-base.md` — public APIs require app identity (project + key), sessions/refresh/M2M/IdP discovery like ST recipes.

---

## T1 — France FDI lock

| Probe | Result |
|-------|--------|
| POST `…/fdi/signinup/code` no headers | **401** `project_required` |
| Project header only | **401** `auth_key_required` |
| Bad `pk_briven_auth_…` | **401** `invalid_auth_key` |
| Valid Krypco project + key | **200** `status:OK`, delivery **mittera** |

**PASS**

Unit: `bun test src/services/auth-core/fdi-guard.test.ts` → **8 pass**

---

## T2 — Engine client + first-party proxy

| Probe | Result |
|-------|--------|
| Mavi `POST https://pay.mavifinans.sh/api/auth/signinup/code` (server injects pk + project) | **200** OK · mittera as “mavi pay” |
| Direct `GET /v1/auth-core/session/me` without cookie | **401** `authenticated:false` (expected) |

**PASS** (proxy injects keys; session me needs cookie)

---

## T3 — Session refresh

| Probe | Result |
|-------|--------|
| POST `…/fdi/session/refresh` with project+key, no refresh token | **401** `refresh token required (cookie sRefreshToken or body.refreshToken)` |

Endpoint live and fails closed without token. Full rotate (new handle / old dies) needs a real login cookie — **partial live**; unit `session.test.ts` **5 pass**.

**PASS (contract live)** · full rotate = browser after login

---

## T4 — MFA (password)

Unit only this run (no live enroll cycle):

- `mfa-challenge.test.ts` **5 pass**
- `mfa.test.ts` **4 pass**

Live enroll → MFA_REQUIRED → verify → me: **not re-run** (needs password user with TOTP).

**PASS (unit)** · live path deferred human

---

## T5 — M2M

| Probe | Result |
|-------|--------|
| POST `/v1/auth-core/oauth/token` bogus client | **401** `invalid_client` / unknown client |

Unit: `m2m.test.ts` **3 pass** (sign/verify/role).

Create→token→API→revoke needs dashboard CLI token — **not** run without secrets.

**PASS (fail path live + unit)** · full smoke needs project admin

---

## T6 — Migration

Unit: `emailpassword.test.ts` **6 pass** including `import:bcrypt` + `import:argon2id` verify + upgrade flag.

POST `/v1/auth-core/migration/users` with only public key → **401** (admin CLI auth) — expected.

**PASS (unit + endpoint gated)**

---

## T7 — Captcha

Valid FDI code **without** `turnstileToken` returned **200** → Turnstile **off** on France (secret unset).

Unit: `abuse-captcha.test.ts` **2 pass** (allows when off; denies when forced on).

**PASS (off = documented)**

---

## T8 — SSO / IdP

| Probe | Result |
|-------|--------|
| GET `/v1/auth-core/oidc/.well-known/openid-configuration` | **200** full discovery (issuer, authorize, token, jwks, revoke, …) |
| GET `/v1/auth-core/oidc/jwks.json` | available via discovery `jwks_uri` |

Unit: `sso.oidc-return.test.ts` **2 pass**.

Full browser consent: optional human.

**PASS (discovery live + unit)**

---

## Gold-path audit (B) — same day

| App | FDI gold path | Leftover auth-tenant | Action |
|-----|---------------|----------------------|--------|
| **Mavi** | `/api/auth/*` → FDI live **200** | `/v1/auth-tenant` proxy still hit API **410** | **Fixed:** remap legacy route → FDI + session/me |
| **Krypco** | `/api/auth` FDI + local fixed `@briven/auth` | getSession was tenant; proxy no session/me | **Fixed:** SDK session/me + proxy special case |
| **Pando** | FDI proxy present | no auth-tenant hits | OK (handoff path) |
| **Konnos** | live login FDI comments | JWKS default → auth-tenant | **Fixed:** default → `/v1/auth-core/oidc/jwks.json` |
| **@briven/auth** | OTP/magic FDI | getSession/signOut tenant; password still bridge | **Fixed:** session + signOut engine; password bridge still legacy |
| **examples/auth-pilot** | — | still tenant in middleware | residual docs/example (not prod) |

---

## Claim update

Still **cannot claim 100% SuperTokens** until:

1. SMS live-prove **or** N/A approved  
2. Optional passkeys human retest  
3. Framework breadth N/A if desired  
4. Mavi/Krypco deploys pick up route fixes (Mavi needs ship)

Day-to-day SaaS login remains **~90–95%** with stronger evidence after this test block.

---

## Artifacts

- Live curl logs: `/tmp/auth-harden-evidence-2026-07-29/`  
- Unit: bun tests under `apps/api/src/services/auth-core/*.test.ts`

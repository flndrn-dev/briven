# Briven Auth build progress (local only)

**Engine product name:** `briven-engine`  
**Deploy:** **BLOCKED** until complete Briven Auth is built (flndrn rule)  
**Updated:** 2026-07-22 (overnight build)

## Done in code (not live-approved)

### Foundation
- [x] Old customer Auth product routes → 410
- [x] Compose service renamed `briven-engine`
- [x] DB name `briven_engine`
- [x] Env `BRIVEN_ENGINE_CONNECTION_URI`
- [x] Probe `/v1/auth-core/info` + `/ready`
- [x] Project → tenant map

### Recipes (SDK load list)
- [x] session
- [x] emailpassword
- [x] passwordless (**SMS included**)
- [x] thirdparty (catalog)
- [x] emailverification
- [x] webauthn / passkeys
- [x] multifactorauth + totp + userroles
- [x] usermetadata + accountlinking + dashboard
- [x] multitenancy + oauth2provider + openid + jwt + saml

### APIs
- [x] FDI Hono adapter `/v1/auth-core/fdi/*`
- [x] Session me / list / revoke
- [x] Recipes / providers / delivery catalogs
- [x] Users list + metadata
- [x] Project config + provider secrets + SMS secrets
- [x] Tenant ensure + list
- [x] Roles create/assign/list
- [x] TOTP create/list/remove

### SDK
- [x] `@briven/auth/engine` client
- [x] `@briven/auth/engine/server` session helper
- [x] Next.js first-party proxy snippet

### Dashboard (yellow Authentication)
- [x] Overview, providers, sessions, security, users, enterprise, domains, keys, projects, branding — all **briven-engine** copy

### Tests
- [x] project-map unit tests
- [x] recipe catalog unit tests

### Multitenancy + project config + migration
- [x] Per-project encrypted social + SMS secrets (tenant_secrets)
- [x] `GET/PUT` project config + provider + SMS APIs
- [x] Ensure tenant + list tenants
- [x] Roles + TOTP MFA APIs
- [x] FDI resolves `x-briven-project-id` → tenant
- [x] Migration users import (plaintext + bulkimport/hash path)
- [x] All yellow Auth tabs show briven-engine content

### Delivery + keys + UI forms + scaffolds (this pass)
- [x] SMTP send when `BRIVEN_SMTP_*` set
- [x] Twilio-compatible SMS when project secrets set
- [x] Dashboard forms: providers + SMS + create SDK key
- [x] Keys API under `/v1/auth-core/projects/:id/keys`
- [x] Framework scaffolds (`@briven/auth/engine` scaffolds)
- [x] Local compose file `compose.briven-engine.local.yml` (not production)

### Open items closed this pass
- [x] Dashboard session / project-admin on write APIs
- [x] Tenant injected on every FDI login call (query + body + Multitenancy getTenantId)
- [x] Local e2e: compose hello OK + SDK sign-up smoke script
- [x] Feature audit doc (`BRIVEN-AUTH-FEATURE-AUDIT.md`)
- [x] JDBC scheme `postgresql://` for wire protocol only; **SQL host = Doltgres** (not stock Postgres)
- [x] `briven-engine-db-init` + `ensureBrivenEngineDatabase()` create `briven_engine` on Doltgres
- [x] Documented Core crash on Doltgres: `SET SESSION CHARACTERISTICS is not yet supported` → see `BRIVEN-ENGINE-DOLTGRES-GOTCHA.md`

### Step 1 proof (2026-07-22) — local Doltgres
- [x] Local Doltgres up; DB `briven_engine` created
- [x] Schema tables ready
- [x] Email/password sign-up OK
- [x] Sign-in OK
- [x] Wrong password rejected
- [x] Session row in Doltgres
- [x] Script: `apps/api/scripts/step1-password-proof.mjs`
- **Not** live-deployed; **not** flndrn phase OK yet

### Step 2 proof (2026-07-22) — local Doltgres
- [x] Email OTP create + consume → user + session
- [x] Email magic link create + consume → user + session
- [x] SMS OTP create + consume → user + session (delivery: log until Twilio secrets)
- [x] Wrong OTP rejected
- [x] Codes one-time (deleted after use)
- [x] FDI routes: `/signinup/code` + `/signinup/code/consume`
- [x] Script: `apps/api/scripts/step2-passwordless-proof.mjs`
- **Not** live-deployed; **not** flndrn phase OK yet

### Step 3 proof (2026-07-22) — local Doltgres
- [x] Google + GitHub authorisation URL builders
- [x] Real code→profile exchange implemented (needs live client secrets)
- [x] Sign-up/sign-in with social profile → `be_users` + `be_third_party_links` + session
- [x] Same Google account second login = same user
- [x] GitHub path OK
- [x] FDI: `/authorisationurl`, `/signinup`
- [x] Script: `apps/api/scripts/step3-social-proof.mjs`
- **Not** live-deployed; browser OAuth needs real client id/secret when you wire them

### Step 4 proof (2026-07-22) — first-party proxy
- [x] `proxyBrivenEngineAuth` + `brivenEngineNextHandler` in `@briven/auth/engine`
- [x] Next route: `apps/web/src/app/api/auth/[...path]/route.ts`
- [x] Path map `/api/auth/signup` → FDI `/signup`
- [x] Local app:3010 proxies to API:3011; Set-Cookie on **app** response
- [x] Sign-up + sign-in via proxy OK (Doltgres storage)
- [x] Script: `apps/api/scripts/step4-proxy-proof.mjs`
- [x] Unit tests: `packages/auth/src/engine/proxy.test.ts`

### Step 5 proof (2026-07-22) — yellow dashboard ↔ Doltgres
- [x] `GET /v1/auth-core/dashboard` — counts + methods + recent users (Doltgres)
- [x] Users list includes `tenantId` + `storage: doltgres`
- [x] Yellow overview / users / sessions pages use `apiFetch` (session cookies)
- [x] Local proof: 10 users, 12 sessions, methods flags, all storage doltgres
- [x] Script: `apps/api/scripts/step5-dashboard-proof.mjs`

### Deepen pass (2026-07-22) — MFA + passkeys + Google UI
- [x] TOTP on Doltgres (`be_totp_devices`) enroll / wrong code / verify / login check
- [x] Passkeys on Doltgres (`be_webauthn_*`) register + authenticate → session
- [x] Providers form loads configured status after save; Google-focused copy
- [x] Security tab documents MFA/passkeys APIs
- [x] Proof: `apps/api/scripts/deepen-mfa-passkeys-proof.mjs`
- [x] Parity doc: `BRIVEN-AUTH-FEATURE-AUDIT.md`

### Open items pass (2026-07-22)
- [x] Stronger passkeys via `@simplewebauthn/server` (full response verify in prod)
- [x] Google/GitHub OAuth start + callback routes + web callback page
- [x] Roles on Doltgres (`be_roles`, `be_user_roles`) create/assign/list/permissions
- [x] FDI rate limit (Redis or Doltgres) + optional Turnstile on signup/signin
- [x] Proof: `apps/api/scripts/open-items-proof.mjs`
- [ ] **Live browser Google with YOUR real client secrets** (code ready; needs your keys)
- [ ] **Deploy** only when you say ship

## Still building (local)
- [ ] Live Google secrets smoke with real console credentials (you provide)
- [ ] **Live deploy + your OK** (only when you allow)

## Five steps status
| Step | Status |
|------|--------|
| 1 Password on Doltgres | **PROVED (local)** |
| 2 SMS + magic link | **PROVED (local)** |
| 3 Google/GitHub social | **PROVED (local)** |
| 4 First-party proxy | **PROVED (local)** |
| 5 Yellow dashboard data | **PROVED (local)** |

## Rules
1. No deploy until complete.
2. Customer-facing name is always **briven-engine**.
3. Platform operator login (briven.tech Better Auth) untouched.
4. Nothing DONE without live proof + flndrn OK.

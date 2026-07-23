# Briven Auth feature audit (briven-engine · Doltgres only)

**Updated:** 2026-07-23  
**Storage rule:** COMPLETE Briven project = **Doltgres**. Auth does not use stock Postgres.  
**Engine:** `0.8.0-enterprise-sso`  
**SuperTokens:** docs = **checklist only** (no Core).

Legend: **Y** = implemented + proof · **P** = partial · **N** = not yet · **N/A** = won’t do (documented)

---

## Architecture

| Capability | Status | Notes |
|------------|--------|-------|
| briven-engine product name | Y | |
| Doltgres DB `briven_engine` | Y | |
| First-party proxy `/api/auth` | Y | |
| SuperTokens Core Docker | N/A | Removed (Doltgres incompatible) |
| SuperTokens docs as checklist | Y | Feature inventory only |

---

## Login methods (app users)

| Method | Status | Evidence |
|--------|--------|----------|
| Email + password | Y | Phase 2 live |
| Email OTP | Y | Phase 3 live |
| Email magic link | Y | Phase 3 live |
| SMS OTP | P | Engine + log; Twilio secrets optional |
| Google OAuth | Y | Platform env + project secrets UI |
| GitHub OAuth | Y | Platform env + project secrets UI |
| Other social (Apple, Discord, …) | P | Catalog + secrets store; not all exchange paths |
| Passkeys | Y | Phase 5 live |
| TOTP MFA | Y | Phase 5 live |

---

## Sessions & security

| Item | Status |
|------|--------|
| Sessions on Doltgres | Y |
| Session list / revoke / recent | Y |
| User roles + permissions | Y | Phase 6 |
| Rate limit | Y | |
| Captcha (Turnstile) | P | When secret set |

---

## Yellow dashboard (operator)

| Tab | Status | API |
|-----|--------|-----|
| Overview | Y | `/v1/auth-core/dashboard`, `/info` |
| Users | Y | `/v1/auth-core/users` |
| Sessions | Y | `/v1/auth-core/session/recent` |
| Security (roles) | Y | `/v1/auth-core/roles` |
| Keys | Y | `/v1/auth-core/projects/:id/keys` |
| Providers | Y | `/v1/auth-core/projects/:id/config` + PUT providers |
| Enterprise (tenants + SSO) | Y | Enable Auth + live Auth status + SAML/OIDC connections |
| Branding / domains | N | Still later / legacy paths |

---

## Enterprise / IdP (full SuperTokens enterprise)

| Item | Status |
|------|--------|
| Project → tenant map | Y |
| Enable Auth (create tenant) | Y |
| SAML SSO login | Y | `/v1/auth-core/sso/saml/*` + ACS + metadata; `productionReady` when IdP URL+cert set |
| OIDC enterprise SSO login | Y | `/v1/auth-core/sso/oidc/*` + discovery + callback |
| SSO connection admin UI | Y | Enterprise tab CRUD on yellow dashboard |
| Briven as OAuth2/OIDC IdP | N | Apps use Briven login; Briven is not yet a full IdP for third parties |
| M2M client credentials | N | |
| AI auth extras | N | |

---

## Migration / plugins / 100%

| Item | Status |
|------|--------|
| Bulk user/hash import | P | |
| 492-URL master walk | P | This audit + plan Phases 7–8 |
| Framework integration pack | N | Phase 8 |
| Claim “100% SuperTokens feature surface” | N | Fail list not empty |

---

## How to read “100%”

We only claim 100% when **every** SuperTokens knowledge-base area is **Pass** or **N/A with your OK**.  
Today: login core + yellow operator tabs are largely Pass; enterprise IdP + migration + full plugin/integration matrix remain open.

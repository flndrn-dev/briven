# Briven Auth — state (Option B)

**Updated:** 2026-07-23 (session saved — see `NEXT-SESSION.md`)

| Phase | What | Status |
|-------|------|--------|
| 2–5 | Login APIs (EP, passwordless, social, MFA, passkeys) | **Live** |
| 6 | Users / sessions / roles | **Live** |
| 7 | Keys / providers / enterprise tabs | **Live** |
| **8 SSO** | SAML + OIDC enterprise (SP mode) | Built; verify with real IdP |
| **9 Konnos login** | Live konnos.org OTP → mint | **Done** (API e2e proved) |
| Polish | SMS + branding + delivery | **Next** |
| Deep ST | IdP / M2M / audit | **After polish** |

## Auth enabled (what “on” means)

A project is **really Auth-enabled** when `be_tenants` has a row for it on Doltgres  
(`briven_engine`). That is what the Enterprise tab and workspace use.

## Live login paths (briven-engine)

| Flow | URL |
|------|-----|
| Email OTP / magic create | `POST /v1/auth-core/fdi/signinup/code` |
| Consume code / link | `POST /v1/auth-core/fdi/signinup/code/consume` |
| Session me | `GET /v1/auth-core/session/me` |
| Social start | `GET /v1/auth-core/fdi/authorisationurl` |
| Social finish | `POST /v1/auth-core/fdi/signinup` |
| SAML start | `GET /v1/auth-core/sso/saml/:connectionId` |
| OIDC start | `GET /v1/auth-core/sso/oidc/:connectionId` |

Headers: `x-briven-project-id` + `x-briven-engine: briven-engine`.  
Prefer first-party app proxy so cookies sit on the app domain.

**Retired:** `/v1/auth-tenant/*` → **410 Gone**.

## Enterprise SSO (SP)

**productionReady** = required IdP fields present (SAML: SSO URL + cert; OIDC: client id/secret + issuer or endpoints).

## Not yet (SuperTokens-class holes)

- Briven as full OAuth2/OIDC **provider for other apps** (IdP mode)
- M2M client credentials
- Security **audit** trail (enterprise depth)
- Full SuperTokens 492-URL empty fail list / “100%” claim
- SMS product polish + branding polish (next block)

## Email

mittera (or SMTP if `BRIVEN_SMTP_*` set).

## Live deploy notes

- France host: `187.124.64.116`
- Briven code: `/etc/dokploy/compose/briven-brivenfrance-uilsk6/code` · API `4fcb9ff`
- Konnos code: `/etc/dokploy/applications/app-back-up-haptic-circuit-58nwnf/code`
- Git remotes may lag; rsync → rebuild is the proven fallback

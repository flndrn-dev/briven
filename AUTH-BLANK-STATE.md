# Briven Auth — state (Option B)

**Updated:** 2026-07-23  

| Phase | What | Status |
|-------|------|--------|
| 2–5 | Login APIs | Live |
| 6 | Users / sessions / roles | Live |
| 7 | Keys / providers / enterprise tabs | Live |
| **8 SSO** | SAML + OIDC enterprise on briven-engine | **Built locally** — ship with COMMIT+PUSH+DEPLOY |

## Auth enabled (what “on” means)

A project is **really Auth-enabled** when `be_tenants` has a row for it on Doltgres  
(`briven_engine`). That is what the Enterprise tab and workspace use.

## Enterprise SSO (production login paths)

| Flow | URL |
|------|-----|
| SAML start | `GET /v1/auth-core/sso/saml/:connectionId` |
| SAML ACS | `POST /v1/auth-core/sso/saml/:connectionId/acs` |
| SAML metadata | `GET /v1/auth-core/sso/saml/:connectionId/metadata` |
| OIDC start | `GET /v1/auth-core/sso/oidc/:connectionId` |
| OIDC callback | `GET /v1/auth-core/sso/oidc/:connectionId/callback` |
| Admin CRUD | `/v1/auth-core/projects/:projectId/sso/connections` |

**productionReady** = required IdP fields present (SAML: SSO URL + cert; OIDC: client id/secret + issuer or endpoints).

## Not yet

- Briven as full OAuth2/OIDC **provider for other apps** (IdP mode)
- M2M client credentials
- Full SuperTokens 492-URL empty fail list

## Email

mittera (or SMTP if set).

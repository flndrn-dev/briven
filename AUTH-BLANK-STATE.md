# Briven Auth — state (Option B)

**Updated:** 2026-07-23  

| Phase | What | Status |
|-------|------|--------|
| 2–5 | Login APIs (password, codes, social, MFA, passkeys) | Live (France) |
| 6 | Yellow dashboard: users, sessions, roles | Live (France) |
| **7 tabs** | Keys, providers, enterprise (tenants) | **Built locally** — ship when you say COMMIT+PUSH+DEPLOY |

## Dashboard tabs (signed in to briven.tech)

| Tab | What |
|-----|------|
| Overview | Counts + methods |
| Users | App end-users |
| Sessions | Active app sessions |
| Security | Roles create/list |
| **Keys** | Mint / list / revoke `pk_briven_auth_…` |
| **Providers** | Social secrets per project + platform methods |
| **Enterprise** | Enable Auth, tenants list; SAML/OIDC **not live yet** (honest copy) |

## Operator APIs opened (Phase 7)

- `GET /v1/auth-core/workspace`
- `POST /v1/auth-core/projects/:projectId/enable`
- `GET /v1/auth-core/projects/:projectId/config`
- `PUT /v1/auth-core/projects/:projectId/providers/:thirdPartyId`
- `GET|POST|DELETE /v1/auth-core/projects/:projectId/keys…`
- `GET /v1/auth-core/tenants`

## App login APIs

Unchanged — FDI under `/v1/auth-core/fdi/*`.

## Full SuperTokens checklist

See `BRIVEN-AUTH-FEATURE-AUDIT.md` (living Pass / Partial / Missing).  
Deep enterprise (SAML, Briven as IdP, M2M) and 492-URL pass are **not** claimed yet.

## Email

mittera (or SMTP if `BRIVEN_SMTP_*` set).

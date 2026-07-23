# Briven Auth — state (Option B)

**Updated:** 2026-07-23  

| Phase | What | Status |
|-------|------|--------|
| 2–5 | Login APIs (password, codes, social, MFA, passkeys) | Live (France) |
| **6** | Yellow dashboard: users, sessions, roles/security | Built locally — ship when you say COMMIT+PUSH+DEPLOY |

## Dashboard (operator, signed in to briven.tech)

| Tab | Data |
|-----|------|
| Overview | Engine version, counts, methods |
| Users | `GET /v1/auth-core/users` |
| Sessions | `GET /v1/auth-core/session/recent` |
| Security | Methods + roles list + create form (`/v1/auth-core/roles`) |

## Operator APIs (need briven.tech session)

- `GET /v1/auth-core/dashboard`
- `GET /v1/auth-core/users`
- `GET /v1/auth-core/session/recent`
- `GET|POST /v1/auth-core/roles`, `POST .../roles/assign`, `GET .../users/:id/roles`

## App login APIs

Unchanged from Phase 5 — FDI under `/v1/auth-core/fdi/*`.

## Email

mittera (or SMTP if `BRIVEN_SMTP_*` set).

## Pay + DB

Same Doltgres family; same project id.

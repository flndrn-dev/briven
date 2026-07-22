# Briven Auth — state (Option B Phase 2)

**Updated:** 2026-07-22  
**Decision:** Phase 0 Option **B** — native briven-engine on Doltgres (no SuperTokens Core product).

## What is live (Phase 2)

1. **Dashboard Auth** — engine version, storage doltgres, **password login open**.
2. **App login APIs (briven-engine on Doltgres):**
   - `POST /v1/auth-core/fdi/signup` — email + password
   - `POST /v1/auth-core/fdi/signin`
   - `POST /v1/auth-core/fdi/signout`
   - `GET /v1/auth-core/session/me` — verify session
3. **Status:**
   - `GET /v1/auth-core/info` · `ready` · `map/:projectId`
4. **Still 410 / closed:** old Better Auth customer product, full dashboard Auth data, MFA admin, keys UI APIs, migration, etc.
5. **How apps call it:** first-party proxy  
   `https://your-app.com/api/auth/*` → `https://api.briven.tech/v1/auth-core/fdi/*`  
   Header: `x-briven-project-id: <project id>`

## How it fits with Pay + DB

| Product | Job | Doltgres |
|---------|-----|----------|
| Briven DB | App tables | `proj_<id>` |
| Briven Auth | Who is logged in | `briven_engine` |
| Briven Pay | Money | Pay path (same platform family) |

Same project id ties them together for mavi-pay and others.

## Platform login

briven.tech dashboard login is **unchanged** (Better Auth on control plane).  
That is **not** the same door as app end-users.

## Next

Phase 3+ (passwordless, social, MFA, …) only after flndrn says start.

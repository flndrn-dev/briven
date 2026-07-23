# Briven Auth — state (Option B)

**Updated:** 2026-07-23  

| Phase | What | Ship |
|-------|------|------|
| **2 (live after deploy)** | Email/password + sessions on Doltgres | commit `7097457` + deploy |
| **3 (local only)** | + email OTP, magic link, SMS OTP | **not** committed/pushed/deployed yet |

## Phase 2 (shipped code path)

- `POST /v1/auth-core/fdi/signup` · `/signin` · `/signout`
- `GET /v1/auth-core/session/me`
- `GET /v1/auth-core/info` · `/ready` · `/map/:projectId`
- Storage: Doltgres `briven_engine`

## Phase 3 (local workspace only)

- `POST /v1/auth-core/fdi/signinup/code` (email or phone)
- `POST /v1/auth-core/fdi/signinup/code/consume` (OTP or magic link)
- Session cookies use handle (same as Phase 2)
- Delivery: log mode unless SMTP/Twilio secrets set
- Proof: `bun scripts/step2-passwordless-proof.mjs` → **PHASE 3 LOCAL PROOF OK**

## How Auth fits Pay + DB

Same Briven project + Doltgres family: Auth vault `briven_engine`, app data `proj_*`, Pay on its path.

## Platform login

briven.tech operator login unchanged (`/v1/auth/*`).

## Local verify Phase 3

```bash
bun test apps/api/src/services/auth-core/passwordless.test.ts \
  apps/api/src/services/auth-core/emailpassword.test.ts \
  apps/api/src/services/auth-core/session.test.ts

cd apps/api && \
BRIVEN_ENGINE_DATABASE_URL=postgres://postgres:devpass@127.0.0.1:5434/briven_engine?sslmode=disable \
BRIVEN_DATA_PLANE_URL=postgres://postgres:devpass@127.0.0.1:5434/postgres?sslmode=disable \
BRIVEN_AUTH_CORE_ENABLED=true BRIVEN_ENV=development \
bun scripts/step2-passwordless-proof.mjs
```

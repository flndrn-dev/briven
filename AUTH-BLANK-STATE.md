# Briven Auth — state (Option B Phase 1)

**Updated:** 2026-07-22  
**Decision:** Phase 0 Option **B** — native briven-engine on Doltgres (no SuperTokens Core product).

## What is live (Phase 1 shell)

1. **Dashboard Auth** (`/dashboard/auth`) shows:
   - engine name **briven-engine**
   - engine **version**
   - storage **doltgres** / DB `briven_engine`
   - clear line: **not ready for app login yet**
2. **API status (open for shell):**
   - `GET /v1/auth-core/info`
   - `GET /v1/auth-core/ready`
   - `GET /v1/auth-core/map/:projectId`
3. **API closed (410):** old customer Auth + full engine product (FDI, users, dashboard data, enable, …)
4. **Boot:** `initAuthCoreSdk()` ensures Doltgres DB + schema when `BRIVEN_AUTH_CORE_ENABLED=true`
5. **Defaults:** `BRIVEN_AUTH_ENABLED=false` (old Better Auth customer product), `BRIVEN_AUTH_CORE_ENABLED=true` (engine shell)

## What stays (on purpose)

- **Platform operator login** on briven.tech: Better Auth via `/v1/auth/*`
- Sidebar **Auth** link → Phase 1 shell page (butter yellow accent)

## What we will not do (locked)

1. SuperTokens branding / Core container for product Auth  
2. Different visual system for Auth  
3. Open app login before flndrn OK on later phases  
4. Fork SuperTokens  

## Next

Phase 2+ (sessions, recipes, …) only after flndrn says start — see `BRIVEN-AUTH-100-PERCENT-BUILD-PLAN.md`.

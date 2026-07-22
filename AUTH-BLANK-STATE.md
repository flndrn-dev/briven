# Briven Auth — blank + clean (2026-07-22)

## What was done

1. **Dashboard Auth** (`/dashboard/auth`) is a **single blank page** (projects-style header + empty state). No feature tabs.
2. All Auth sub-routes redirect to that blank page.
3. **Overview** no longer shows Auth project cards / enable UI.
4. **API:** customer Auth product paths always **410** via `auth-product-retired` router:
   - `/v1/auth-tenant/*`
   - `/v1/auth-v2/*`
   - `/v1/projects/:id/auth/*`
   - `/v1/projects/:id/scim/*`
   - `/v1/auth-core/*` (native briven-engine product surface off)
5. **Not mounted:** Better Auth multi-tenant product routers, SCIM, all auth-core product routers, engine SDK boot.
6. **Defaults:** `BRIVEN_AUTH_ENABLED=false`, `BRIVEN_AUTH_CORE_ENABLED=false`.

## What stays (on purpose)

- **Platform operator login** on briven.tech: Better Auth via `/v1/auth/*` and `lib/auth.ts` — so you can still open the dashboard.
- Sidebar **Auth** link → blank page (butter yellow accent only).

## What we will not do (locked)

1. SuperTokens branding in UI  
2. Different visual system for Auth  
3. Engineer phase/rebuild copy in UI  
4. **Fork SuperTokens**

## Next (only with flndrn OK)

Phase 0 of `BRIVEN-AUTH-100-PERCENT-BUILD-PLAN.md` — SuperTokens Core on Doltgres.

# Handoff: Briven Auth (v2 product surface)

**Status:** DASHBOARD READY (2026-07-22) — use yellow **Authentication** for config  
**Who for:** Konnos, Mavi Pay, Cyberbear, future apps, agents  
**Who not for:** inventing Clerk/Firebase/Auth0 side systems

---

## Plain picture

1. Briven dashboard → **Authentication** (sidebar).  
2. **projects** → enable Auth on the project you need.  
3. **providers / security / branding / enterprise / keys / domains / users**.  
4. Put `pk_briven_auth_…` in the app.  
5. Login traffic still hits Briven’s auth-tenant path (Better Auth pool) with project context — do not stand up a second auth DB.

```
BRIVEN_AUTH_V2=DASHBOARD_READY
OLD_AUTH_DASHBOARD=RETIRED
APP_SETUP=USE_EXISTING_@briven/auth_OR_PROXY
ENGINE=auth-tenant_(Better_Auth)_+yellow_config
```

---

## Agent rules

1. Do **not** invent Clerk/Firebase.  
2. Do **not** rebuild old `/dashboard/projects/…/auth/*` panels — use **Authentication**.  
3. SuperTokens `knowledge-base.md` is for platform recipes only.  
4. Prefer `pk_briven_auth_…` in browsers; never `brk_` in the browser.  
5. Magic links should open on the **app URL** (project origin + first-party proxy), not a bare API page.

---

## What shipped (engine + gaps)

- Passwordless defaults ON after Enable Auth  
- Provider save with live re-read proof  
- 2FA + 10 backup codes, password rules, session inactivity  
- Device tracking + new-device email  
- OAuth auto-link same email; admin unlink  
- SSO SAML/OIDC; SCIM; compliance pack  
- Per-connection SSO usage meters (`auth_sso_connections`, `auth_sso_signins`) when Polar meters are configured  
- GDPR export, rate limits (Redis optional), passkey rpID from app domains  

---

## App wiring (short)

1. Enable Auth + domains + methods in **Authentication**.  
2. Mint **keys**.  
3. Use `@briven/auth` with `publicKey` + project id (existing package).  
4. First-party proxy on the app domain so cookies and magic links stay on your site.  

Full deep engine rewrite (replace Better Auth core) is **not** required for product use; config is ready now.

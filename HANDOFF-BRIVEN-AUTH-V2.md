# Handoff: New Briven Auth (v2) — for all projects

**Status:** PHASE 1 DASHBOARD LIVE (2026-07-22) — app wiring still WAIT  
**Who for:** Konnos, Mavi Pay, Cyberbear, future apps, agents  
**Who not for:** building a side auth system (Clerk/Firebase/Auth0)

---

## What changed (plain)

Briven is **rebuilding Auth** into its own yellow product area.

- Old project tab **Auth** (providers, keys, domains inside the project) is **closed**.  
- New home: dashboard sidebar → **Briven Auth** (yellow area).  
- **Phase 1 live:** enable Auth, providers (save with live proof), keys, domains, users, sessions (last-seen).  
- Product goal: SuperTokens-quality login (sessions, passwordless, social, MFA later) on **Briven Doltgres**.

Until this handoff says **OPEN / READY**, do **not** invent a new app setup path. Prefer email/OTP paths that already work on live if your app is production-critical, or wait for full READY.

---

## How setup will work (target)

1. Briven dashboard → open your **project** → **Enable Auth** (connects this project’s DB).  
2. Sidebar → **Briven Auth** (yellow) → choose methods, domains, keys.  
3. Copy `pk_briven_auth_…` into the app env.  
4. Install `@briven/auth` (v2 when published) + first-party proxy on your domain.  
5. Sign-in: magic link / OTP / password / passkey as enabled.

---

## Agent rules (now)

1. Do **not** invent Clerk/Firebase.  
2. Do **not** “fix” old `/dashboard/projects/…/auth/providers` UI — it is intentionally blanked.  
3. Use `knowledge-base.md` (SuperTokens doc URLs) only while **building platform Auth**, not as a reason to leave Briven.  
4. When handoff status becomes **READY**, follow this file only for app wiring.

---

## Status line for agents

```
BRIVEN_AUTH_V2=PHASE1_DASHBOARD
OLD_AUTH_DASHBOARD=RETIRED
APP_SETUP=WAIT_FOR_READY
```

Yellow dashboard config is live in code; full engine + app handoff still building. Update this block when v2 is fully READY.

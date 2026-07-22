# Briven Auth v2 — rebuild plan (Option B)

**Date:** 2026-07-22  
**Decision:** Tear down / hide old Auth UI **now**. Ship only the new Briven Auth surface when ready.  
**Reference library:** `knowledge-base.md` (SuperTokens docs URLs for agents).

---

## Product picture (plain words)

Briven Auth becomes its **own product area** inside the Briven dashboard:

1. User opens a **project** → can **Enable Auth** (hooks this project’s DB to Auth).  
2. User opens **Briven Auth** (yellow sidebar) → full login product: methods, users, sessions, providers, keys, domains.  
3. End-user apps use a simple setup handoff (one file for all projects).

Look: **yellow accent** so nobody confuses Auth with Project/DB.  
Engine: **new**, SuperTokens-inspired (first-party sessions, reliable recipes), on **Briven Doltgres**.  
Old Better Auth dashboard UI: **gone** (blank / redirect only).

---

## Phases

### Phase 0 — Blank slate UI — **Done**
- Sidebar + mobile: **Authentication** entry.  
- Old project Auth UI retired / moved notice.  

### Phase 1 — Core packaging — **Done**
- Recipes v1 on project Doltgres via auth-tenant: email+password, magic link, OTP, passkeys, sessions.  
- Provider save with read-back proof (`/v1/auth-v2/*`).  

### Phase 2 — Auth sub-dashboard — **Done**
- Yellow shell: overview, projects, providers, security, branding, enterprise, users, sessions & devices, keys, domains.  

### Phase 3 — App path + handoff — **Done (docs)**
- Magic links open on project URL.  
- `HANDOFF-BRIVEN-AUTH-V2.md` marked DASHBOARD_READY.  
- First-party proxy remains app-side (scaffold / existing Konnos pattern).  

### Phase 4 — SuperTokens depth — **Done (packaged)**
- MFA + backup codes, SSO, SCIM, device tracking, account linking, rate limits, attack-adjacent hardening from gap-fix — all on Briven Doltgres.  
- Full Java SuperTokens Core self-host remains a non-goal.

---

## Non-goals (for now)
- Full SuperTokens Java Core self-host for customers.  
- Keeping old provider UI alive in parallel (user chose B).  
- Inventing Clerk/Firebase.

---

## Success
A non-coder can: enable Auth on a project → open yellow Briven Auth → turn on methods → get a key → wire app from handoff → login works **once**.

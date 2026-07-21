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

### Phase 0 — Blank slate UI (this PR)
- Sidebar + mobile: **Briven Auth** entry (yellow when active).  
- `/dashboard/auth/*` shell pages (blank / “building”).  
- Old `/dashboard/projects/[id]/auth/*` → single “moved” notice.  
- Project tab **auth** removed or points to new section.  
- API may still exist for now so existing apps don’t hard-crash overnight; **dashboard config of old Auth is closed**.

### Phase 1 — Core engine (new)
- SuperTokens-shaped layers: frontend contract + backend routes + core logic.  
- Data in **project Doltgres** (or dedicated auth schema per project — decide in implement).  
- Recipes v1: email+password, magic link, email OTP, passkeys, sessions.  
- Provider save that **always** persists + reloads live instance (proof tests).

### Phase 2 — Auth sub-dashboard
- Yellow shell filled: overview, enable status per project, providers, users, sessions, keys, domains, branding.  
- Config only here (not buried only under project tabs).

### Phase 3 — App path + handoff
- Scaffold: first-party proxy on app domain.  
- Magic links open on **project URL**.  
- One `HANDOFF-BRIVEN-AUTH-V2.md` for Konnos / Mavi / all.

### Phase 4 — SuperTokens depth (later)
- MFA, roles, multi-tenant enterprise, M2M, attack protection — pull from knowledge-base recipes.

---

## Non-goals (for now)
- Full SuperTokens Java Core self-host for customers.  
- Keeping old provider UI alive in parallel (user chose B).  
- Inventing Clerk/Firebase.

---

## Success
A non-coder can: enable Auth on a project → open yellow Briven Auth → turn on methods → get a key → wire app from handoff → login works **once**.

# briven-engine = Doltgres ONLY (FINAL)

**HARD RULE (flndrn final warning):** The **complete** Briven project is **Doltgres**.  
That does **not** change when we add Auth or any other new part.

---

## What this means

| Allowed | Forbidden |
|---------|-----------|
| Auth tables in Doltgres DB `briven_engine` | Stock Postgres for Auth data |
| briven-engine code inside Briven API | SuperTokens Core Docker needing special Postgres features |
| `BRIVEN_ENGINE_DATABASE_URL` → `@doltgres:5432/briven_engine` | “Use postgres temporarily so Core works” |
| Feature checklist inspired by SuperTokens docs | Running SuperTokens Core as a second database brain |

---

## What we removed

- SuperTokens Core container (`supertokens-postgresql` service) from product compose  
- Any plan to put Auth on stock Postgres so Core can boot  

**Why Core is gone:** Core crashes on Doltgres (`SET SESSION CHARACTERISTICS`).  
We do **not** “fix” that by leaving Doltgres. We build **briven-engine native on Doltgres**.

---

## What briven-engine is now

```
Customer app → first-party /api/auth → Briven API (/v1/auth-core/fdi/*)
                                         ↓
                                   briven-engine (API code)
                                         ↓
                              Doltgres DB `briven_engine`
                              (be_users, be_sessions, …)
```

---

## Implemented on Doltgres (local)

- Ensure DB `briven_engine` on Doltgres  
- Schema: tenants, users, password hashes, sessions, passwordless codes, third-party links  
- Email/password sign-up + sign-in + session create  
- Project → tenant map (`proj-…`)  

---

## Plain words

Briven is one building: **Doltgres**.  
Auth is a room **in that building**, not a shed in the backyard made of ordinary Postgres.  
If a third-party vault tool can’t live in Doltgres, we don’t move the whole building — we build our own vault **inside** Doltgres.

# Brainstorm audit: Briven Auth must be Clerk-simple

**Date:** 2026-07-21  
**Who for:** flndrn + every agent wiring login on Konnos, Mavi Pay, Cyberbear, future apps  
**Who not for:** inventing off-platform auth (Clerk/Firebase) as a workaround  

---

## Problem in plain words

Setting up login on Briven felt like a maze:

- Switches left **off** by default (magic / OTP / passkey)
- Agents told to “toggle providers” while code paths were **wrong**
- Live apps **not redeployed** while repos were fixed
- MCP chat bound to **one project** while humans fixed **another**
- Docs/skills said “human only” for steps agents can do with write keys

A five-year-old product (Clerk) wins because **one path works first time**.  
Briven must match that bar.

---

## Failure modes we proved (2026-07)

| # | Failure | Symptom | Root cause | Fix status |
|---|---------|---------|------------|------------|
| 1 | Passwordless OFF by default | “Providers still off” after Enable Auth | `DEFAULT_AUTH_CONFIG` magic/OTP/passkey = false | **Defaults ON** (this change) |
| 2 | Passkey wrong site name | Face ID fails in browser | `rpId` always `briven.tech` | **Live** `61a97a0` — derive from allowed domains |
| 3 | Wrong OTP send path in SDK | 404 on send | `@briven/auth` used `/sign-in/email-otp/send-…` | **Fixed** in monorepo; apps must use published path |
| 4 | Wrong OTP verify path | Code never creates session | Apps used `/email-otp/verify-email` for sign-in | **Correct** is `/sign-in/email-otp` |
| 5 | Magic link wrong field | Land on wrong host after click | `redirectTo` vs `callbackURL` | SDK maps redirectTo → callbackURL |
| 6 | Repo ≠ live app | Fixed in Git, broken in browser | Mavi not redeployed | **Process** — deploy after push |
| 7 | MCP project ≠ user project | “OFF” reported while Mavi was ON | Agent MCP bound to Cyberbear | Skill: **always auth_config_get on the app project** |
| 8 | Schema drift | Empty HTTP 500 on magic/OTP | Missing tables/columns | Self-heal on boot + fleet heal |
| 9 | `*.auth.briven.tech` TLS | Browser blocks magic link | No wildcard cert | Emails use `api.briven.tech` |
| 10 | Agent thrash | 8 hours of re-toggle | Skills taught “ask human to toggle” | **auth_enable_passwordless** + starter pack on Enable |

---

## Clerk-simple target (product)

### One path (success = first login works)

```
1. briven setup my-app     OR   briven connect p_…
2. Enable Auth once        (dashboard or POST …/auth/enable)
   → tables + magic/OTP/passkey ON + localhost allowed
3. Mint pk_briven_auth_…   (dashboard or MCP auth_mint_public_key)
4. briven auth scaffold
5. Add production domain   (Auth → Allowed Domains)
6. pnpm add @briven/auth && run app
7. Sign in with email code or magic link
```

No second “turn on providers” step. No inventing Clerk.

### Non-goals (for this audit)

- Building a full Clerk dashboard clone  
- Wildcard `*.auth.briven.tech` cert (blocked on DNS token today)  
- OAuth without client id + secret  

---

## Design decisions (defaults we chose)

| Decision | Choice | Why |
|----------|--------|-----|
| Default providers | Email + magic + OTP + passkey **ON** | First login works; OAuth still opt-in |
| Enable Auth | Write starter pack + seed `localhost:3000` | One click ≈ working local login |
| Passkey rpId | From allowed app domains | Face ID on customer host |
| Magic link base URL | `api.briven.tech` | Valid public certificate |
| Agent writes | `auth_enable_passwordless` + mint key | No “wait for human” if key can write |
| Skill truth | Single ordered path + known wrong paths | Stop agent path invention |

---

## Implementation checklist

### Platform (Briven monorepo) — done or in this PR

- [x] Passkey rpId from origins  
- [x] SDK OTP send/verify correct paths + status-aware magic  
- [x] Hosted pages OTP paths  
- [x] DEFAULT passwordless ON  
- [x] Enable Auth persists starter pack + localhost origin  
- [ ] Publish `@briven/auth` so npm consumers get fixes without monorepo  
- [ ] `briven auth scaffold` calls enable + mint when brk_ available (CLI follow-up)  
- [ ] One-click “copy env for Next” in dashboard  

### App projects (Mavi / Konnos / …)

- [ ] Always **redeploy after** auth path fixes  
- [ ] Allowed Domains = real production origin  
- [ ] Never ship `brk_` in browser  

### Skills / agents

- [x] Rewrite `briven-auth` skill to Clerk-simple path + gotchas  
- [ ] MCP always bound to the **app** project under repair  

---

## Verification (how we know it’s fixed)

1. New project → Enable Auth → `auth_config_get` shows magic/OTP/passkey **true** without manual toggle  
2. POST magic-link + OTP send return **200** with `pk_briven_auth_` + allowed Origin  
3. Passkey GET returns **rpId** matching customer domain (not always briven.tech)  
4. Wrong OTP path `/sign-in/email-otp/send-verification-otp` still **404** (do not document as live)  
5. Fresh scaffold + env key → browser can complete OTP or magic without agent debug  

---

## Gotchas (never repeat)

1. **GitHub green ≠ site live** — check app deploy SHA / JS paths  
2. **MCP project ≠ all tenants** — “OFF” on Cyberbear is not Mavi  
3. **POST passkey generate-options = 404 by design** — use GET  
4. **rate_limited** after agent spam — wait or new email  
5. **Passkey on localhost** fails when rpId is production domain — test on real Allowed Domain  

---

## Success definition (flndrn)

> A new project gets working email login (code or magic link) in **one short path**, without an all-day agent war, without re-toggling providers that were already saved, and without living on a site that still runs last week’s JavaScript.

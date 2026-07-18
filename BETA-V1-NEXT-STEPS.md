# Beta v1 — next steps tracker

**Owner:** flndrn  
**Started:** 2026-07-18  
**Goal:** Move from “platform exists” to “friends can rely on a pilot.”

Three needles, in order:

1. **Auth go-live checklist** (browser proof on a real project)  
2. **S6 reliability bar** (isolation + Redis notes + status story)  
3. **Dogfood one real app** end-to-end  

---

## Status board

| # | Work | Status | Evidence |
| --- | --- | --- | --- |
| 1 | AUTH-GO-LIVE on pilot project | **In progress** — platform OK; browser rows need human | This file §1 + `AUTH-GO-LIVE-CHECKLIST.md` |
| 2a | Second-project isolation | **Code tests + doc** — human confirm still required | unit tests + §2.1 |
| 2b | Redis chaos notes + tests | **Done** | `docs/S6-RELIABILITY.md` + `auth-rate-limit.test.ts` |
| 2c | Status / metrics / admin snapshot | **Done** | status pages + `/v1/admin/auth-reliability` + Health panel |
| 3 | Dogfood app (auth-pilot) | **Path ready** — needs env keys + one browser pass | `examples/auth-pilot` |

**Product claim “friends can use auth”:** only after §1 sign-off rows **0–4 + 7** are pass.

---

## 1. Auth go-live (pilot)

### 1.1 Automated / agent checks (2026-07-18)

| Check | Result |
| --- | --- |
| `GET https://api.briven.tech/health` | **PASS** — `status: ok`, `env: production` |
| `GET https://api.briven.tech/ready` | **PASS** — all ok including **`redis: ok`** |
| `GET https://api.briven.tech/info` | **PASS** — production; note `buildSha` may lag latest git by a few deploys |
| Status pages | **PASS** — `briven.tech/status` and `docs.briven.tech/status` return 200 |

→ Checklist **row 0 = PASS** (agent-verified).

### 1.2 Human browser path (you)

Use **one real project** you care about (or create “auth-pilot”).

Open: [AUTH-GO-LIVE-CHECKLIST.md](./AUTH-GO-LIVE-CHECKLIST.md)

Minimum for pilot trust (must all pass):

| # | Item | Who |
| --- | --- | --- |
| 0 | Platform ready + redis ok | **Agent: PASS 2026-07-18** |
| 1 | Auth enabled on project | **You** |
| 2 | Public key `pk_briven_auth_…` | **You** |
| 3 | Sign-up + sign-in | **You** |
| 4 | Wrong password rejected | **You** |
| 7 | Session after refresh | **You** |

Optional if you enable them: magic link, Google, rate-limit burst, 2FA backup codes, second friend on pilot URL.

### 1.3 Second project (S6.1 isolation)

After pilot works:

1. Create a **second** project in the dashboard (or `briven setup --name isolation-b`).  
2. Enable Auth + create a **different** public key.  
3. Sign up user `alice@…` on project A only.  
4. Confirm project B **Users** list does **not** show Alice.  
5. Confirm project B’s auth key cannot list/sign in as project A’s user.

**Pass:** two projects never share users/sessions/keys.

### 1.4 Sign-off box (fill when done)

| # | Item | Pass? | Notes |
| --- | --- | --- | --- |
| 0 | Platform ready + redis ok | ☑ agent | 2026-07-18 |
| 1 | Auth enabled | ☐ | project id: ________ |
| 2 | Public key created | ☐ | suffix last4: ________ |
| 3 | Sign-up + sign-in | ☐ | |
| 4 | Wrong password rejected | ☐ | |
| 7 | Session after refresh | ☐ | |
| S6.1 | Second project isolated | ☐ | project B id: ________ |
| 10 | Friend can use pilot URL | ☐ | |

Date: ________  Name: ________

---

## 2. S6 reliability bar

Full write-up: **[docs/S6-RELIABILITY.md](./docs/S6-RELIABILITY.md)**

| Item | Status |
| --- | --- |
| S6.1 Isolation | Procedure above; confirm in browser |
| S6.2 Redis chaos | Documented (fail-open to memory when Redis client missing; `/ready` reports redis) |
| S6.3 Metrics | Guidance: watch auth 5xx + rate-limit logs; Redis via `/ready` |
| S6.4 Status story | Live status page + degradation blurb on status/docs |
| S6.5 Changelog | Ship when human sign-off lands |
| S6.6 Plans updated | `sprint_plan.md` status board |

---

## 3. Dogfood — one real app

**App:** `examples/auth-pilot` (minimal real browser sign-in kit).

```bash
cp -r examples/auth-pilot ~/Desktop/auth-pilot-dogfood
cd ~/Desktop/auth-pilot-dogfood
# Prefer setup once you have CLI credentials for the pilot project:
briven setup --project <p_YOUR_PILOT>
briven auth scaffold
pnpm add @briven/auth
# paste pk_briven_auth_… into .env.local (never commit)
# run your Next host, open /sign-in, complete checklist 3–4–7
```

**Success:** someone else can open your pilot URL, sign up, sign out, sign in — without you pasting code at them.

Optional second dogfood later: `examples/todo-app` for schema + functions + deploy (not auth-only).

---

## 4. Order of work today

1. **You (15–30 min):** checklist rows 1–4 + 7 on one project.  
2. **You (10 min):** second project isolation (§1.3).  
3. **You or agent:** wire auth-pilot or any Next app to that project; one friend sign-up.  
4. **Agent after sign-off:** mark S6 done in `sprint_plan.md`, changelog “Auth reliability,” freeze claim language.

---

## 5. What we will *not* claim yet

- “Clerk-level reliability” until this file’s sign-off is complete.  
- Public open signup without rate-limit proof (row 8 optional but recommended).  
- DoltGres as “boring Postgres forever” — still beta engine; keep limitations link in docs.

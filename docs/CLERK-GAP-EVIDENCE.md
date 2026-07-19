# Clerk gap sprint — evidence pack

**Sprint:** Close Clerk Auth Gap for Beta (L1/L2) — see `sprint_plan.md`  
**Updated:** 2026-07-19  

---

## B — Production freshness

| Check | Result | When |
| --- | --- | --- |
| GitHub Actions auto-deploy | **OFF** (manual `workflow_dispatch` only; no push trigger) | 2026-07-18/19 |
| Dokploy `autoDeploy` | **false** (disabled via API) | 2026-07-19 |
| Manual deploy | **SSH France rebuild `api` only** | 2026-07-19 |
| Prod `/ready` | **ready** — control/data/runtime/redis **ok** | 2026-07-19 |
| Prod `/info` buildSha | **`2e81f239bdada4b191dfb4c0dac514d31492e9f3`** (S6 reliability commit) | 2026-07-19 |
| `./scripts/s6-auth-verify.sh` | **PASS** | 2026-07-19 |

### Verify anytime

```bash
./scripts/s6-auth-verify.sh
curl -sS https://api.briven.tech/info
```

Note: docs/scripts-only commits after this do **not** need another API deploy unless API code changes. Next intentional API deploy = SSH rebuild or Dokploy/manual Actions when secrets are set.

---

## A — Human proof (fill when done)

| # | Item | Pass? | Notes |
| --- | --- | --- | --- |
| 0 | Platform ready + redis ok | ☑ agent | `s6-auth-verify.sh` 2026-07-19 |
| 1 | Auth enabled | ☐ | project: |
| 2 | Public key created | ☐ | last4: |
| 3 | Sign-up + sign-in | ☐ | |
| 4 | Wrong password rejected | ☐ | |
| 7 | Session after refresh | ☐ | |
| S6.1 | Second project isolation | ☐ | project B: |
| Claim | Friends can use this | ☐ | date/name: |

Full steps: `AUTH-GO-LIVE-CHECKLIST.md` · tracker: `BETA-V1-NEXT-STEPS.md`  
Isolation helper: `./scripts/auth-isolation-check.sh` · how-to: `scripts/auth-isolation-verify.md`

---

## C — Soft gaps (agent) — **DONE**

| Item | Status |
| --- | --- |
| Auth-pilot dogfood path | `examples/auth-pilot/README.md` (10-min path + friend step) |
| Isolation how-to | `scripts/auth-isolation-verify.md` + `docs/runbooks/auth-tenant-isolation.md` |
| Isolation shell helper | `scripts/auth-isolation-check.sh` |
| Rate-limit / reliability tests | 8 unit pass (6 integration skip without pen-test env) |
| Mail custom domain notes | `docs/S6-RELIABILITY.md` + this pack |
| Admin auth reliability | `/v1/admin/auth-reliability` + Health panel (**live** on `2e81f23`) |
| Pen-test integration | Env-gated in `auth-tenant-isolation.test.ts` |

### Mail deliverability (custom domains)

1. Auth → branding → set sender domain.  
2. Add DNS records shown (SPF/DKIM).  
3. Until verified, Briven falls back to `noreply@briven.tech`.  
4. If magic links fail: spam, branding, `/ready`, then mailer counters after deploy.

### Pen-test (optional)

```bash
export BRIVEN_PEN_TEST_RUN=1
export BRIVEN_PEN_TEST_TENANT_A_ID=p_...
export BRIVEN_PEN_TEST_TENANT_B_ID=p_...
export BRIVEN_PEN_TEST_TENANT_A_TOKEN=...
export BRIVEN_PEN_TEST_TENANT_B_TOKEN=...
export BRIVEN_PEN_TEST_API_ORIGIN=https://api.briven.tech
cd apps/api && bun test src/services/auth-tenant-isolation.test.ts
```

---

## D — Out of scope (this sprint)

SCIM · full compliance sales kit · deep OIDC/SAML polish · SMS · Clerk UI clone  

---

## Isolation checklist (human, 10 min)

1. Project **A**: Auth on → key A → sign up `user-a+pilot@…`  
2. Project **B**: Auth on → key B (different)  
3. B → Auth → Users: **must not** list user-a  
4. App with key B + project B: new sign-up only creates user on B  

---

## Final scoreboard

| Layer | Status |
| --- | --- |
| Features (Clerk day-to-day) | Built |
| Ops (no auto-spam deploys + one intentional deploy) | **Done** — prod on S6 `2e81f23` |
| Soft gaps tooling/docs | **Done** |
| Trust claim “friends can use this” | **Blocked only on human proof A1–A4** |

# S6 — Auth reliability bar (ops notes)

Plain-language notes for the “can people rely on this?” gate.  
Companion: `AUTH-GO-LIVE-CHECKLIST.md`, `BETA-V1-NEXT-STEPS.md`, `sprint_plan.md`.

---

## S6.1 Multi-tenant isolation (two projects)

**What we claim:** each Briven project’s auth users, sessions, and `pk_briven_auth_…` keys are **scoped to that project**. Project A’s users never appear in Project B’s Auth → Users list; Project B’s public key cannot act as Project A.

**How it is enforced in the platform (code-level):**

- Auth is **tenant-pooled per project** (Better Auth instance + data-plane binding per project).  
- API keys and auth SDK keys carry a **project id**; middleware rejects cross-project use.  
- Admin auth UI routes are under `/v1/projects/:id/auth/…` with project auth.

**How you prove it (human, 10 minutes):**

```bash
./scripts/auth-isolation-check.sh          # prints steps + runs s6 probes
# full how-to: scripts/auth-isolation-verify.md
# runbook:     docs/runbooks/auth-tenant-isolation.md
```

1. Project A: enable Auth, create key A, sign up `user-a@example.com`.  
2. Project B: enable Auth, create key B (different key).  
3. Project B → Auth → Users: **must not** list `user-a@example.com`.  
4. Point a test app at key B + project B id; sign-up creates a **new** user B only.  
5. (Optional) Try using key A with project B id in env → should fail auth (wrong project).

**Pass:** no shared user rows, no shared sessions, no shared keys across projects.  
**Evidence:** fill `docs/CLERK-GAP-EVIDENCE.md` section A (S6.1).

---

## S6.2 Redis chaos (rate limits)

### What Redis does for auth

- **Rate limits** on login / signup bursts (IP + email buckets).  
- Other platform features (e.g. logs streaming) also use Redis.  
- `/ready` reports `checks.redis`: `ok` | `unreachable` | `not_configured`.

**Production (2026-07-18 agent probe):** `"redis":"ok"` on `https://api.briven.tech/ready`.

### What happens if Redis dies

| Layer | Behavior |
| --- | --- |
| **`/ready`** | If `BRIVEN_REDIS_URL` is set and Redis is down → **not ready** (orchestrators can stop routing). |
| **Rate limiter** | If Redis client is unavailable at check time → falls back to **in-memory** buckets on that API instance (`checkMemoryRateLimit`). That is **fail-open for multi-instance accuracy** (limits work per process, not globally). Comment in code: fail-open when redis missing. |
| **Logins themselves** | Do **not** require Redis to complete a normal sign-in. Users can still authenticate if control DB + auth tenant are up. |

### Chaos lite procedure (ops)

**Do not run destructive Redis kill on production without flndrn OK.**

Safe staging procedure:

1. Note baseline: `curl -s https://api.briven.tech/ready | jq .checks.redis` → `ok`.  
2. On staging only: stop Redis briefly (or block port).  
3. Observe `/ready` flips redis to `unreachable` (and overall not ready if redis required).  
4. Attempt a login on staging: expect **still works** (DB path), rate limits may weaken (memory fallback or fail path).  
5. Restore Redis; `/ready` → redis `ok` within seconds.  
6. Burst wrong passwords: expect rate limit again once Redis is healthy.

**Customer-facing summary:**  
“If our cache layer blips, sign-in should still work; abuse protection may be softer until cache returns. We mark the platform not-ready so monitors page us.”

---

## S6.3 What to watch (metrics / logs)

| Signal | Where |
| --- | --- |
| Platform awake | `GET /health`, `GET /ready` |
| Redis | `checks.redis` on `/ready` |
| **Auth reliability snapshot** | `GET /v1/admin/auth-reliability` (admin session) · admin cockpit **Health → auth reliability (S6)** |
| Prometheus | `GET /metrics` → `briven_auth_rate_limit_denied_total`, `briven_auth_rate_limit_memory_fallback_total`, `briven_auth_mailer_failures_total`, `briven_auth_route_5xx_total` |
| Auth errors | API logs: `auth_*`, `rate_limiter_redis_error`, `briven_auth_*`, `auth_rate_limit_using_memory_fallback` |
| Mailer failures | Counter + logs when tenant send fails after fallback |
| Deploy freshness | `GET /info` → `buildSha` vs git `main` |
| Automated probes | `./scripts/s6-auth-verify.sh` (read-only; no deploy) |

**Unit tests (no Redis required for memory path):**

```bash
cd apps/api
bun test src/services/auth-rate-limit.test.ts src/services/auth-reliability.test.ts src/services/auth-tenant-isolation.test.ts
```

**Alert ideas (minimal):** page if `/ready` fails 2+ minutes; page if redis unreachable while URL configured; page if `briven_auth_route_5xx_total` or mailer failures spike.

### Mail deliverability (custom domains)

1. Dashboard → project → Auth → branding → set **sender domain**.  
2. Add the DNS records shown (SPF / DKIM as listed).  
3. Until verified, Briven falls back to `noreply@briven.tech` so login mail still works.  
4. If magic links fail: check spam, branding config, `GET /ready`, then mailer failure counters after API deploy (`briven_auth_mailer_failures_total` / admin Health → auth reliability).

---

## S6.4 Status / comms — what customers see

**Live page:** [https://briven.tech/status](https://briven.tech/status) (and docs status probe).

### If auth is degraded (draft blurb — post as incident when real)

> **Investigating — sign-in delays**  
> Some users may see slow or failed sign-in. Data and already-open sessions are unaffected. We’re checking the auth path and cache layer. Updates every 30 minutes.

### If Redis only is degraded

> **Degraded — rate limiting**  
> Core API and databases are up. Temporary cache issues may reduce abuse protection and some live-log features. Sign-in should still work. No action needed from you.

### If all clear

Status page shows green probes for api / realtime / web / docs.

---

## S6.5 Release notes (when checklist signed)

Ship a short public note (changelog + optional status):

> **Auth reliability (beta)**  
> Browser go-live checklist completed on pilot + isolation check on a second project. Production `/ready` includes Redis. Rate limits use Redis with in-memory fallback. See docs/auth and AUTH-GO-LIVE-CHECKLIST.

---

## S6 definition of done

### Code / ops (agent-deliverable) — **DONE 2026-07-18**

- [x] Redis behavior documented (this file)  
- [x] Status degradation story on status pages  
- [x] Rate-limit memory fallback unit tests (S6.2)  
- [x] Per-project rate-limit isolation unit test  
- [x] Auth reliability counters + `GET /v1/admin/auth-reliability` + admin Health panel  
- [x] Prometheus `briven_auth_*` metrics help + mailer/5xx hooks  
- [x] `./scripts/s6-auth-verify.sh` platform probe script  
- [x] Tenant redaction isolation unit tests  

### Human (product claim “friends can rely on auth”)

- [ ] AUTH checklist rows 1–4 + 7 on pilot (`AUTH-GO-LIVE-CHECKLIST.md`)  
- [ ] Second project isolation confirmed in dashboard  
- [ ] flndrn says “yes, friends can use this”  

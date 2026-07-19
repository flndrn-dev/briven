# Runbook: Auth tenant isolation

**Purpose:** Prove Project A’s users never show up on Project B (Clerk multi-app trust).  
**Sprint:** Clerk gap L1/L2 — see `sprint_plan.md` and `docs/CLERK-GAP-EVIDENCE.md`.

---

## Human path (required for product claim)

~10 minutes in the dashboard:

1. **Project A** → Auth → enable → create public key `pk_…` for A.  
2. Sign up a user only on A (hosted auth or auth-pilot).  
3. **Project B** → Auth → enable → create a **different** public key.  
4. Project B → Auth → **Users** → user from step 2 must **not** appear.  
5. Optional: app with B’s project id + B’s key → new signup appears only on B.

Helper script (prints steps + runs platform probes):

```bash
./scripts/auth-isolation-check.sh
# optional: pass two project ids for pen-test hints
./scripts/auth-isolation-check.sh p_AAA p_BBB
```

Record pass/fail in `AUTH-GO-LIVE-CHECKLIST.md` and `docs/CLERK-GAP-EVIDENCE.md`.

---

## Automated unit tests (always run)

```bash
cd apps/api
bun test src/services/auth-tenant-isolation.test.ts
```

These cover redaction / invariants without two live tenants.

---

## Optional live pen-test (two real tenants)

**Do not enable in CI by default.** Needs two real project ids + owner tokens.

```bash
export BRIVEN_PEN_TEST_RUN=1
export BRIVEN_PEN_TEST_TENANT_A_ID=p_...
export BRIVEN_PEN_TEST_TENANT_B_ID=p_...
export BRIVEN_PEN_TEST_TENANT_A_TOKEN=...   # project A owner session/token
export BRIVEN_PEN_TEST_TENANT_B_TOKEN=...
export BRIVEN_PEN_TEST_API_ORIGIN=https://api.briven.tech
cd apps/api && bun test src/services/auth-tenant-isolation.test.ts
```

---

## Design rule (never break)

All reads/writes of tenant auth tables must go through **`runInProjectSchema`** (project-scoped path).  
Any new code path that skips that is a **v1 blocker**.

Audit idea: search for raw auth-user queries outside project schema helpers on every PR that touches auth.

---

## If isolation fails in production

1. **Stop** advertising multi-project auth; do not onboard new pilots.  
2. Capture: project ids A/B, key suffixes (last4 only), timestamp, API `buildSha` from `/info`.  
3. Check whether keys were swapped (same `pk_` on both apps) — human config error first.  
4. Escalate to platform agent with logs for `auth_*` and project id in request context.  
5. After fix: re-run human path + optional pen-test; update evidence pack.

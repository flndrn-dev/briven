# Close the last ~15% — SuperTokens parity (execution log)

**Started:** 2026-07-28  
**Order:** Batch A → B → C → D (approved “Full last 15%”)

## Batch A — Trust (security locks live)

| Item | Status |
|------|--------|
| C1–C5 code (FDI key lock, magic-link allowlist, MFA challenge, rate limit, project admin) | Local + unit tests |
| Deploy to France `api` (+ web) via `safe-redeploy-service.sh` | **Done 2026-07-28** |
| Live probe: unauth `POST …/fdi/signinup/code` | **PASS — HTTP 401** `project_required` |
| Live probe: project header without key | **PASS — HTTP 401** `auth_key_required` |
| Re-prove 2026-07-29 (+ bad key + valid key) | **PASS** — see `AUTH-HARDEN-TEST-EVIDENCE-2026-07-29.md` |

## Batch B — Login completeness

| Item | Status |
|------|--------|
| Passkeys hosted UI → FDI webauthn (not auth-tenant 410) | Code done + web redeployed |
| Passkey engine client helpers + scaffold | Code done |
| Live Mavi enroll→sign-in retest | **Human** (Mavi already on FDI + key) |
| SMS | **Ops-blocked** — product honest (Twilio From + secrets). See `SMS-TWILIO-LIVE-PROVE.md`. Matrix stays **P** until live prove **or** flndrn marks N/A. |

## Batch C — Depth

| Item | Status |
|------|--------|
| IdP service E2E (`apps/api/scripts/idp-e2e-proof.mjs`) | Run after deploy |
| IdP browser consent path | Still recommended human |
| Migration foreign bcrypt/argon2 verify + upgrade to scrypt | Code done |

## Batch D — DX + claim

| Item | Status |
|------|--------|
| Framework pack: Next gold + passkey scaffold | Done |
| Captcha on passwordless create when Turnstile secret set | Code done |
| Captcha EP signup/signin when secret set | Already done |
| Explicit N/A list | Below — needs flndrn OK to claim 100% |

## Proposed N/A (won’t match SuperTokens 1:1)

Approve to clear the matrix:

1. **SuperTokens Core Docker** — already N/A (briven-engine on Doltgres).  
2. **Every framework SDK** (Vue/Svelte/etc.) — Next + Express + Hono + vanilla scaffolds only unless a real project needs more.  
3. **SMS OTP** — optional N/A until Twilio compliance ready (or keep **P** and prove later).  
4. **ST bulk-import job queue** (list/delete jobs) — single batch POST max 500 is enough for v1.

## Claim rule

**100% SuperTokens** only when every matrix row is **Y** or **N/A (approved)**.

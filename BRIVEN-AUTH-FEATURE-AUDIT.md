# Briven Auth feature audit (briven-engine · Doltgres only)

**Updated:** 2026-07-22  
**Storage rule:** COMPLETE Briven project = **Doltgres**. Auth does not use stock Postgres.  
**Deploy:** BLOCKED until complete + flndrn OK.

Legend: **Y** = implemented + local proof · **P** = partial · **N** = not yet

---

## Architecture

| Capability | Status | Notes |
|------------|--------|-------|
| briven-engine product name | Y | |
| Doltgres DB `briven_engine` | Y | |
| First-party proxy `/api/auth` | Y | Step 4 proved |
| SuperTokens Core Docker | N/A | **Removed** (incompatible with Doltgres) |
| SuperTokens docs as checklist | Y | Feature inventory only |

---

## Login methods

| Method | Status | Evidence |
|--------|--------|----------|
| Email + password | Y | step1 |
| Email OTP | Y | step2 |
| Email magic link | Y | step2 |
| SMS OTP | Y | step2 (delivery log until Twilio secrets) |
| Google OAuth URL + user/link/session | Y | step3 + exchangeCode implemented |
| GitHub OAuth URL + user/link/session | Y | step3 |
| Real browser OAuth with live secrets | P | needs project/env client id+secret |
| Passkeys register + authenticate | Y | `@simplewebauthn/server` verify in prod; dev fallback |
| Google browser callback | Y | `/v1/auth-core/oauth/google/*` + `/auth/callback/google` |
| Apple / Discord / … catalog | P | catalog + secrets form; not all exchange paths |

---

## Sessions & security

| Item | Status |
|------|--------|
| Sessions on Doltgres | Y |
| Session revoke / list | Y (dashboard-auth) |
| TOTP enroll / verify / check | Y (deepen proof) |
| Passkey list / delete | Y |
| WebAuthn signature verify | Y | simplewebauthn (prod requires full response) |
| FDI rate limit | Y | Redis or Doltgres `be_rate_limits` |
| Turnstile captcha | Y | when `BRIVEN_TURNSTILE_SECRET_KEY` set |
| User roles product | Y | `be_roles` + `be_user_roles` on Doltgres |

---

## Dashboard (yellow Authentication)

| Item | Status |
|------|--------|
| Overview counts from Doltgres | Y |
| Users list from Doltgres | Y |
| Sessions + methods | Y |
| Providers form (Google secrets) | Y (UI + encrypted store) |
| SMS secrets form | Y |
| Security tab (MFA/passkeys copy) | Y |
| Keys mint | P (API + form; needs session user FK) |

---

## Enterprise / migration / launch

| Item | Status |
|------|--------|
| Project → tenant map | Y |
| SAML / OAuth2 IdP as full product | N |
| Bulk hash import | P |
| 492-URL full walk | P (this file) |
| Live production deploy | N |

---

## Local proofs (scripts)

| Script | Result |
|--------|--------|
| `step1-password-proof.mjs` | OK |
| `step2-passwordless-proof.mjs` | OK |
| `step3-social-proof.mjs` | OK |
| `step4-proxy-proof.mjs` | OK |
| `step5-dashboard-proof.mjs` | OK |
| `deepen-mfa-passkeys-proof.mjs` | OK |

---

## Next deepen (still Doltgres)

1. Full WebAuthn signature verification (CBOR/COSE)  
2. Live Google/GitHub with real client secrets end-to-end in browser  
3. Roles table on Doltgres  
4. Captcha / rate limits on FDI  
5. Your OK + deploy when product is complete  

**Nothing is DONE for shipping without live proof + flndrn OK.**

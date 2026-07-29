# SuperTokens ↔ Briven Auth parity matrix (living tracker)

**Sprint:** AUTH-ST-GAPS-1 + close-last-15% + **AUTH-HARDEN-90**  
**Updated:** 2026-07-29 (harden **test** evidence — see `AUTH-HARDEN-TEST-EVIDENCE-2026-07-29.md`)  
**Rule:** Claim “100% SuperTokens” only when every row is **Y** or **N/A (approved)**.  
**Gold path:** [`AUTH-GOLD-PATH.md`](./AUTH-GOLD-PATH.md)

Legend: **Y** done · **P** partial · **N** not done · **N/A** won’t do

| Area | SuperTokens surface | Briven Auth | Status |
|------|---------------------|-------------|--------|
| Engine | Core + recipes | briven-engine / Doltgres | Y |
| Email password | Recipe | emailpassword (+ foreign hash upgrade) | Y |
| Magic link | Recipe | passwordless magic | Y |
| Email OTP | Recipe | passwordless email | Y |
| SMS OTP | Recipe | passwordless SMS + honesty UI | P (ops: Twilio From) |
| Social | thirdparty | thirdparty catalog | Y |
| Passkeys | webauthn | webauthn FDI + hosted FDI + engine helpers | Y (live retest after deploy) |
| TOTP MFA | multifactorauth | mfa + challenge ticket | Y |
| Sessions | session recipe | native sessions | Y |
| Roles | userroles | be_roles | Y |
| M2M | oauth2 client_credentials | m2m | Y |
| SAML SP | sso | sso saml | Y |
| OIDC SP | sso | sso oidc | Y |
| OIDC IdP | oauth2provider | oidc IdP + hosted login FDI + consent | P → Y for code path 2026-07-29; human app still optional |
| User migration | bulk import | migration API + bcrypt/argon2 verify | Y |
| Framework SDKs | many | Next gold + Express/Hono/vanilla + passkey scaffold | Y (breadth N/A pending) |
| Custom JWT claims | claims | project jwtClaims | Y |
| GDPR export | data export | users/:id/export | Y |
| Username login | username | metadata + flag | Y |
| Captcha | plugin | Turnstile when secret set (EP + passwordless) | Y when keys set; off when not |
| First-party proxy | app domain sessions | /api/auth FDI | Y |
| SuperTokens Core Docker | Core | N/A (Doltgres) | N/A |
| Security FDI lock | app key | pk_briven_auth_ + project required | Y (live re-proved 2026-07-29) |
| Session refresh contract | session recipe | FDI `/session/refresh` | Y (live fail-closed; rotate needs cookie) |
| OIDC IdP discovery | oauth2provider | `…/oidc/.well-known/openid-configuration` | Y (live 200) |
| M2M token fail path | client_credentials | `/v1/auth-core/oauth/token` | Y (live invalid_client) |
| Captcha | plugin | Turnstile when secret set | Y unit; **off** on France (no secret) |

## Claim status

**Cannot claim 100% yet** until:

1. ~~Batch A security is live~~ **Done** (re-proved 2026-07-29).  
2. SMS is either **live-proved** or **N/A approved**.  
3. Optional: IdP human browser once; framework breadth N/A approved.  
4. Apps on gold path only (Mavi/Krypco/Konnos fixes 2026-07-29 — ship Mavi).

Closest path to claim: SMS N/A or prove + approve framework N/A + ship app remaps.

## ~% snapshot (2026-07-29)

| Band | ~% |
|------|-----|
| Day-to-day SaaS login | ~90–95% |
| Full ST-style surface (after harden test) | ~90–93% |
| Official 100% claim | Not claimed |

**Test evidence:** [`AUTH-HARDEN-TEST-EVIDENCE-2026-07-29.md`](./AUTH-HARDEN-TEST-EVIDENCE-2026-07-29.md)

# Briven Auth — state (Option B)

**Updated:** 2026-07-23  

| Phase | What | Status |
|-------|------|--------|
| 2 | Email/password + sessions | Live |
| 3 | Email OTP, magic link, SMS OTP | Live |
| 4 | Google/GitHub + Auth email via mittera/SMTP | Live |
| 5 | TOTP MFA + passkeys | Shipping |

## App login (briven-engine → Doltgres `briven_engine`)

| Feature | Path |
|---------|------|
| Password | `POST .../fdi/signup` · `/signin` · `/signout` |
| Passwordless | `POST .../fdi/signinup/code` · `/signinup/code/consume` |
| Social | `GET .../fdi/authorisationurl` · `POST .../fdi/signinup` |
| TOTP enroll | `POST .../fdi/totp/setup` · `/totp/setup/verify` (session required) |
| TOTP login | After password, if MFA enrolled → `MFA_REQUIRED` then `POST .../fdi/totp/verify` |
| Passkeys | `POST .../fdi/webauthn/register/*` · `/webauthn/signin/*` |
| Session | `GET .../session/me` |

Header: `x-briven-project-id`

## Email

OTP/magic-link: platform chain **SMTP → mittera → log**.  
Live currently uses **mittera** until you set `BRIVEN_SMTP_*` in Dokploy.

## SMTP (deferred by flndrn)

Keep mittera for now. To switch to guaranteed inbox SMTP later, set in Dokploy:

- `BRIVEN_SMTP_HOST`, `PORT`, `USER`, `PASS`, `FROM`  
- Recreate **api** container  

## Pay + DB

Same Doltgres family; same project id.

## Platform login

briven.tech `/v1/auth/*` unchanged.

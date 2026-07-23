# Briven Auth — state (Option B)

**Updated:** 2026-07-23  

| Phase | What | Status |
|-------|------|--------|
| **2** | Email/password + sessions | Live |
| **3** | Email OTP, magic link, SMS OTP | Live |
| **4** | Google/GitHub social + Auth email via platform mail | Shipping |

## App login APIs (`briven-engine` on Doltgres `briven_engine`)

| Method | Path |
|--------|------|
| Password | `POST /v1/auth-core/fdi/signup` · `/signin` · `/signout` |
| Passwordless | `POST /v1/auth-core/fdi/signinup/code` · `/signinup/code/consume` |
| Social | `GET /v1/auth-core/fdi/authorisationurl` · `POST /v1/auth-core/fdi/signinup` |
| Session | `GET /v1/auth-core/session/me` |
| Status | `GET /v1/auth-core/info` (includes `emailDelivery`) · `/loginmethods` |

Header: `x-briven-project-id: <project id>`

## Email for OTP / magic link

Uses the **same platform chain** as briven.tech mail:

1. **SMTP** if `BRIVEN_SMTP_HOST` + `USER` + `PASS` (+ optional `FROM`) are set  
2. Else **mittera** if configured on the API  
3. Else log/stdout (dev)

`GET /v1/auth-core/info` → `emailDelivery.activeTransport` + `realEmailLikely`.

For **guaranteed inbox delivery**, set SMTP in Dokploy (compose already passes the vars).

## Google / GitHub

Platform env (already on France when set):

- `BRIVEN_GOOGLE_CLIENT_ID` / `BRIVEN_GOOGLE_CLIENT_SECRET`  
- `BRIVEN_GITHUB_CLIENT_ID` / `BRIVEN_GITHUB_CLIENT_SECRET`  

Add OAuth redirect URIs for each app, e.g. `https://your-app.com/auth/callback/google`.

## Pay + DB

Same Doltgres family: Auth vault, project DBs, Pay — linked by Briven project id.

## Platform login

briven.tech operator login unchanged (`/v1/auth/*`).

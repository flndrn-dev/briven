# Briven Auth = 100% SuperTokens (complete 8-phase plan)

**Status:** APPROVED 2026-07-22 — Path A + SMS + wipe old customer Auth.  
**Product engine name:** **briven-engine**  
**Storage:** **Doltgres only** — complete Briven project is Doltgres; Auth does not get stock Postgres.  
**SuperTokens Core Docker:** **REMOVED** (incompatible with Doltgres). Feature checklist still uses SuperTokens docs as the instruction book; **runtime = Briven API + Doltgres**.  
**BUILDING LOCALLY.** **NO DEPLOY** until complete + your OK.

---

# PART 0 — What you want (human language)

## Restate (so you can correct me)

You want **Briven Auth** to be a **complete, independent login product inside Briven** — the same kind of product people buy from **SuperTokens** or **Clerk**.

Not a yellow dashboard on broken old code.  
Not “most of it.”  
**All SuperTokens functionality** — as Briven Auth.

Because Auth burned you for days, you ordered:

1. **Blank page**  
2. **Remove old Auth**  
3. **Build new** so the **feature list matches SuperTokens 100%**  
4. SuperTokens docs = **full instruction book** (`knowledge-base.md`)  
5. **Never “done”** until it works **live** and **you** say so  

This file is **only the plan**. No code. No wipe yet. No “it works.”

---

# PART 1 — How 100% SuperTokens is actually possible

## Honest engine rule

| Claim | Reality |
|-------|---------|
| “I rewrote SuperTokens in 8 short AI prompts” | **Lie** |
| “Briven **runs SuperTokens Core** + Briven multi-project product on top” | **Only honest 100% path** |
| “We re-code every recipe from scratch” | Multi-year; cannot promise 100% in 8 phases |

**This plan = Path A (mandatory for 100%):**

```
┌─────────────────────────────────────────────────────────┐
│  Customer apps  →  first-party /api/auth proxy           │
│         ↓                                                 │
│  @briven/auth  (Briven-branded SuperTokens SDKs)         │
│         ↓                                                 │
│  Briven platform (tenants=projects, billing, yellow UI)  │
│         ↓                                                 │
│  SuperTokens Core  (ALL recipes / FDI / CDI logic)       │
│         ↓                                                 │
│  Database (Core DB + Briven project isolation mapping)   │
└─────────────────────────────────────────────────────────┘
```

- **SuperTokens Core** = full functionality vault  
- **Briven** = multi-tenant hosting, Doltgres/project map, yellow **Authentication** product UI, keys, billing, branding  
- Users never install SuperTokens themselves  
- Brand is **Briven Auth**, not SuperTokens logo  

If you reject Path A, **stop** — rewrite required; 100% is no longer honest.

---

# PART 2 — Deep inventory: every SuperTokens area (492 URLs)

Counted from `knowledge-base.md`:

| Section in knowledge-base | URL count | Must be in Briven Auth |
|---------------------------|-----------|-------------------------|
| Quickstart | 6 | Setup path for apps |
| Quickstart integrations | 27 | Next.js, Vercel, Nest, Lambda, GraphQL, Hasura, Netlify, … |
| Authentication recipes | 52 | EP, passwordless, social, enterprise, unified login, M2M, passkeys, AI auth |
| Additional verification | 43 | Sessions protect, MFA, email verify, attack suite, roles, captcha |
| Post-authentication | 32 | Sessions advanced, users, linking, dashboard |
| Migration | 13 | Account/session/MFA/bulk import |
| Platform configuration | 7 | Core keys, IP, SSL, base path, CLI, email/SMS delivery |
| Deployment | 5 | Self-host Core, rate limits, scale, telemetry |
| References (SDKs, FDI, CDI, plugins, testing) | **307** | Full API surface + all recipe SDKs + plugins + test/upgrade |
| **TOTAL** | **492** | **All required for “100% SuperTokens”** |

Below: **complete capability checklist** (nothing optional unless marked *Briven product*).

---

## 2.1 Three-box architecture (non-negotiable)

| # | SuperTokens | Briven Auth must deliver |
|---|-------------|---------------------------|
| A1 | Frontend SDK | New Briven frontend SDK = SuperTokens frontend recipes, Briven-branded |
| A2 | Backend SDK | Backend session/API helpers + **required** first-party proxy on app domain |
| A3 | Core service | **Hosted SuperTokens Core** (Briven-operated) |
| A4 | FDI | Full frontend→backend auth API (all ST FDI groups) |
| A5 | CDI | Full backend→core control API (all ST CDI groups) |
| A6 | Prebuilt UI | Full prebuilt: colours, style, override components, embed, shadow-dom, i18n, ToS/privacy |
| A7 | Function/API overrides + hooks | Frontend + backend overrides, user context, interceptors |

---

## 2.2 Authentication recipes — complete list

### EmailPassword
- Sign-up, sign-in  
- Email exists check  
- Password reset token + consume  
- Password hashing (Core)  
- Password hash **import**  
- Username login  
- Disable signup  
- Customize sign-in / sign-up forms  
- Hooks and overrides  
- Password manager friendly flows  

### Passwordless
- Magic link (open on **app** URL)  
- Email OTP  
- **Phone / SMS OTP** (full SuperTokens includes this)  
- Code create / resend / consume / remove  
- Invite-link flow  
- Allow-list flow  
- Customize magic link + OTP  
- Configure email + SMS behavior  
- Email delivery + SMS delivery platform config  

### ThirdParty (social)
- All SuperTokens **built-in** providers  
- Custom providers (issuer or auth/token/userinfo endpoints)  
- Multiple clients for same provider  
- Authorisation URL  
- Sign-in/up  
- Apple callback special case  
- Hooks/overrides  
- Custom invite flow  
- Per-tenant third-party config (multitenancy)  

### Passkeys / WebAuthn
- Register options + register  
- Sign-in options + sign-in  
- Sign-up  
- Email exists  
- Credential list / get / delete  
- Recover account + token consume  
- Put email on credential  
- Delete options  

### Enterprise / Multitenancy
- Apps (create/list/update/remove)  
- Tenants (create/list/update/remove)  
- Connection URI domains  
- Assign/remove user ↔ tenant  
- Common-domain login  
- Subdomain login  
- Tenant discovery (plugin)  
- Manage tenants / manage apps  
- Tenant management plugin  
- SAML  
- Legacy SAML (if still in ST docs)  
- Important enterprise concepts  

### Unified login / OAuth2 Provider (Briven Auth as IdP)
- OAuth2 basics  
- Multiple frontends one backend  
- Multiple frontends separate backends  
- Reuse website login  
- Scopes  
- Verify tokens  
- Custom claims in tokens  
- Auth endpoint  
- Token (issue/refresh)  
- Introspect  
- Revoke token / session / tokens  
- Userinfo  
- Login / logininfo  
- Consent accept/reject  
- Login request accept/reject  
- Logout / end_session accept/reject  
- Clients: list/get/create/update/remove  
- JWKS  
- OpenID well-known configuration  

### M2M
- Client credentials  
- Legacy M2M flow (if in ST docs)  

### AI authentication
- Full ST “ai-authentication” product behavior as documented  

---

## 2.3 Additional verification — complete list

### Session verification
- Protect API routes  
- Protect frontend routes  
- SSR  
- WebSocket  
- Claim validation  

### MFA (full)
- MultifactorAuth recipe  
- TOTP for all users / opt-in  
- TOTP device list/create/verify/remove/import/update  
- TOTP verify login  
- MFA info  
- Email/SMS OTP as second factor (all + opt-in)  
- WebAuthn as MFA  
- **Backup codes**  
- **Step-up auth**  
- Protect routes with MFA  
- Embed prebuilt MFA UI  
- Hooks/overrides  
- Legacy MFA paths + migration (legacy-to-new, old-sdk-to-new, legacy how-it-works + backend/frontend setups)  

### Email verification
- Introduction + initial setup  
- Protecting routes  
- Manual actions  
- Embed in page  
- Changing style  
- Hooks/overrides  
- Token create/verify/remove (FDI + CDI)  

### Attack protection suite
- Introduction + initial setup (full suite)  

### User roles
- Introduction + setup  
- Role management actions  
- Protecting routes  
- CDI: roles, permissions, user-role assign/remove, permission-roles, role-permissions  

### Captcha
- Captcha docs + captcha-nodejs + captcha-react plugins  

---

## 2.4 Post-authentication — complete list

### Sessions (product)
- Introduction  
- Access session data  
- Session invalidation  
- Share across sub-domains  
- Switch cookies ↔ header auth  
- Anonymous session  
- **User impersonation**  
- Customize error handling  
- Multiple API endpoints  
- Disable frontend interceptors  
- In iframe  
- Access token blacklisting  
- Session security  

### Users
- Introduction + common actions  
- Allow users to update their data  
- User metadata  
- User profile  
- Account deduplication  
- User banning  
- Progressive profiling  
- CDI users list/count/search/active/remove/id-map  

### Account linking
- Introduction + concepts  
- Automatic linking  
- Manual linking  
- Link social accounts  
- Add passwords to existing account  
- CDI: link, unlink, primary, checks  

### Dashboard (operator)
- Introduction + setup  
- User management  
- Tenant management  
- Dashboard sign-in / session verify  
- Map UI → yellow **Briven Authentication** product  

### Other
- Post-login redirect  

---

## 2.5 Migration — complete list

- Overview  
- Account migration  
- Session migration  
- Legacy about + account creation (user create, id map, email verification, EP without hash)  
- Legacy data + session + MFA migration  
- Rownd migration steps + SDK guide (pattern: migrate **into** Briven Auth)  
- CDI bulk import: users, import, delete, count  

---

## 2.6 Platform + deployment — complete list

- Core API keys  
- IP allow/deny  
- SSL via nginx (or Briven Traefik equivalent)  
- Base path  
- CLI  
- Email delivery  
- SMS delivery  
- Self-host SuperTokens (Briven hosts it)  
- Rate limits  
- Scalability  
- Telemetry  
- Migrate-from-MySQL notes → Doltgres/Postgres as required by Core  

---

## 2.7 References / plugins / testing — complete list

### Plugins (all in knowledge-base)
- Introduction  
- Captcha nodejs/react  
- OpenTelemetry nodejs  
- Profile base react  
- Profile details nodejs/react/shared  
- Progressive profiling nodejs/react/shared  
- Tenant discovery nodejs/react  
- Tenants nodejs/react  
- User banning nodejs/react  

### Frontend SDK recipes (auth-react + web-js each)
- package, types  
- emailpassword, emailverification  
- multifactorauth, multitenancy  
- oauth2provider, passwordless  
- session, thirdparty  
- totp, userroles, webauthn  
- hooks, function overrides  
- prebuilt UI: colours, style, override components, embed, shadow-dom, toc/privacy, translations, showcase  

### Backend SDK recipes (nodejs)
- package, types, reference  
- function overrides, API overrides  
- user context, user object, core interceptor  
- emailpassword, passwordless, thirdparty, webauthn  
- emailverification, multifactorauth, accountlinking  
- jwt, multitenancy, dashboard  
- oauth2provider, openid  
- userroles, usermetadata, totp  
- other frameworks  

### FDI groups (all endpoints in knowledge-base)
- email-verification  
- email-password  
- mfa / totp  
- oauth  
- passwordless  
- session  
- thirdparty  
- webauthn  
- get-loginmethods  
- get-jwt-jwks-json  
- get-well-known-openid-configuration  

### CDI groups (all endpoints in knowledge-base)
- account-linking  
- import / bulk-import  
- core (users, count, config, telemetry, ee flags/license, userid map, search tags, active count, …)  
- dashboard  
- email-verification  
- email-password  
- mfa  
- multitenancy  
- oauth  
- passwordless  
- session  
- thirdparty  
- user-metadata  
- user-roles  
- webauthn  

### Testing / ops docs
- API testing  
- How to troubleshoot  
- Common issues  
- Updating SuperTokens  
- Compatibility table  

---

## 2.8 Briven product layer (on top of 100% SuperTokens)

| # | Feature |
|---|---------|
| B1 | Independent **Authentication** product in Briven sidebar |
| B2 | Enable Auth per **project** (tenant map) |
| B3 | `pk_briven_auth_…` keys; no secret keys in browser |
| B4 | Allowed origins / domains |
| B5 | Project isolation (no cross-project user leak) |
| B6 | Billing / metering hooks for Auth as a service |
| B7 | Briven branding on prebuilt UI |
| B8 | Handoff for apps (Konnos, Mavi, …) after live OK |
| B9 | Engine **build version** visible live |

---

# PART 3 — Exactly **8 phases** (100% coverage of Part 2)

**Rule:** Phase N is **not done** until live checklist passes **and you say OK**.

---

## PHASE 1 — Blank page: wipe old Auth + SuperTokens Core online

**Covers:** architecture A3, A5 base, platform config, deployment self-host, Core health, B1 shell, B9  

| Work item | Detail |
|-----------|--------|
| 1.1 | **Delete** all old Briven Auth product implementation (Better Auth tenant product path, dual hybrid UIs, false “complete” paths) |
| 1.2 | Deploy **SuperTokens Core** multi-instance on Briven infra |
| 1.3 | Core DB + SSL/base-path/API keys/IP policy/CLI |
| 1.4 | Map every Briven `projectId` → ST `appId`/`tenantId` |
| 1.5 | Yellow Authentication = blank “Core online / product not ready” only |
| 1.6 | Live health + **engine version** endpoint |

**KB:** deployment/*, platform-configuration/supertokens-core/*, CDI core hello/version/config  

**Live OK criteria (you confirm):**  
- Old Auth cannot be used as product (clear 410/message)  
- Core responds healthy with version  
- Blank Auth UI only  

---

## PHASE 2 — Sessions 100% + proxy + SDK session + verification

**Covers:** all session product + session verification + FDI/CDI session + A1/A2 session + A4 session  

| Work item | Detail |
|-----------|--------|
| 2.1 | Full Session recipe (create/refresh/regenerate/verify/remove/list) |
| 2.2 | Cookie + header modes; subdomain share; blacklist; security |
| 2.3 | Anonymous session; multi-API; iframe; interceptors on/off; error handling |
| 2.4 | Protect API / frontend / SSR / websocket / claims |
| 2.5 | Briven frontend + backend session SDK wrappers |
| 2.6 | **Mandatory** first-party proxy scaffold |
| 2.7 | loginmethods + JWKS/openid plumbing start |

**KB:** session-management/*, session-verification/*, FDI session, CDI session, quickstart FE/BE  

**Live OK criteria:** App domain session survives refresh; revoke works; cookie on **app** host  

---

## PHASE 3 — All primary auth recipes 100%

**Covers:** EmailPassword + Passwordless (email+SMS) + ThirdParty + WebAuthn + prebuilt UI + email/SMS delivery + related FDI/CDI  

| Work item | Detail |
|-----------|--------|
| 3.1 | EmailPassword complete (including hash import, username, disable signup, forms, hooks) |
| 3.2 | Passwordless complete (magic on app URL, email OTP, **SMS OTP**, invite, allow-list) |
| 3.3 | ThirdParty complete (all built-ins, custom, multi-client, secrets, callbacks) |
| 3.4 | WebAuthn complete (register/signin/recover/credentials) |
| 3.5 | Prebuilt UI complete for all recipes above |
| 3.6 | Email + SMS delivery configuration |

**KB:** authentication/email-password|passwordless|social|passkeys/*, FDI/CDI for those, prebuilt-ui, email/sms delivery  

**Live OK criteria (each method):** password; magic link on app URL; email OTP; SMS OTP; Google or GitHub; passkey  

---

## PHASE 4 — MFA + email verify + captcha + attack suite + roles 100%

**Covers:** entire additional-verification section + MFA FDI/CDI + roles CDI + captcha plugins  

| Work item | Detail |
|-----------|--------|
| 4.1 | Email verification complete |
| 4.2 | MFA complete (TOTP lifecycle, second-factor OTP, WebAuthn factor, backup codes, step-up, legacy migration docs supported) |
| 4.3 | Captcha plugins |
| 4.4 | Attack protection suite |
| 4.5 | User roles + permissions + route protection |

**KB:** mfa/*, email-verification/*, captcha, attack-protection-suite/*, user-roles/*, related FDI/CDI  

**Live OK criteria:** verify-email gate; TOTP enroll+login; backup code; step-up; captcha; role 403/200  

---

## PHASE 5 — Users + linking + impersonation + dashboard product 100%

**Covers:** post-auth users/linking/dashboard + profile/ban/progressive plugins + CDI dashboard/users/metadata  

| Work item | Detail |
|-----------|--------|
| 5.1 | Full user management (search, metadata, profile, ban, dedup, self-update) |
| 5.2 | Account linking complete (auto/manual/social/password) |
| 5.3 | Impersonation with audit |
| 5.4 | Progressive profiling plugins |
| 5.5 | Yellow Authentication dashboard = full ST dashboard (users, sessions, tenants, config) |
| 5.6 | Post-login redirect |

**KB:** user-management/*, account-linking/*, dashboard/*, plugins profile/ban/progressive  

**Live OK criteria:** ban; link accounts; impersonate+stop; dashboard matches Core data  

---

## PHASE 6 — Enterprise + OAuth2 IdP + M2M + AI auth 100%

**Covers:** enterprise/*, unified-login/*, m2m/*, multitenancy CDI, oauth FDI/CDI, openid, JWT, AI auth  

| Work item | Detail |
|-----------|--------|
| 6.1 | Multitenancy apps/tenants/domains/user assignment |
| 6.2 | Common/subdomain login + tenant discovery |
| 6.3 | SAML + legacy SAML |
| 6.4 | Per-tenant third-party config |
| 6.5 | Full OAuth2/OIDC provider (Briven Auth as IdP) — all oauth endpoints |
| 6.6 | M2M client credentials (+ legacy if documented) |
| 6.7 | AI authentication features as ST documents |

**Live OK criteria:** SAML sandbox; second app OAuth login via Briven; M2M token; tenant isolation  

---

## PHASE 7 — Migration + bulk import + compatibility 100%

**Covers:** migration/* + CDI import/* + updating/compatibility  

| Work item | Detail |
|-----------|--------|
| 7.1 | Account migration (create, id map, verify state, hash import / without hash) |
| 7.2 | Session migration |
| 7.3 | MFA migration |
| 7.4 | Bulk import API (create/list/delete/count/import) |
| 7.5 | External provider migration guides (Rownd-style → into Briven) |
| 7.6 | Compatibility table Core ↔ SDKs; update playbook |

**Live OK criteria:** Import users with passwords; they sign in on live  

---

## PHASE 8 — Integrations + remaining plugins + scale + full 492-URL parity audit + launch

**Covers:** quickstart integrations (27), remaining plugins, overrides, deployment scale/rate/telemetry, testing/debug, Briven product packaging B1–B9, **final audit of all 492**  

| Work item | Detail |
|-----------|--------|
| 8.1 | All framework integrations (Next app+pages, Vercel, Nest, Lambda, GraphQL, Hasura, Netlify, …) |
| 8.2 | OpenTelemetry + any leftover plugins |
| 8.3 | Full override/hook systems FE+BE |
| 8.4 | Rate limits, scalability, telemetry, multi-instance production hardening |
| 8.5 | API testing + troubleshooting + common issues docs |
| 8.6 | Briven Auth as sellable service: enable, keys, domains, billing, handoff |
| 8.7 | **Master parity audit:** walk Part 2 checklist line-by-line against **live** system; gap list must be **zero** |
| 8.8 | You sign: **“Briven Auth is complete SuperTokens functionality for me”** |

**Live OK criteria:** Fresh project scaffold full login; **you** sign parity audit  

---

# PART 4 — Mapping: knowledge-base sections → phases

| knowledge-base section | Phase(s) |
|------------------------|----------|
| Quickstart (6) | 2, 3, 8 |
| Integrations (27) | 8 (+ samples in 2–3) |
| Authentication recipes (52) | 3, 6 |
| Additional verification (43) | 2, 4 |
| Post-authentication (32) | 2, 5 |
| Migration (13) | 7 |
| Platform configuration (7) | 1, 3 (delivery), 8 |
| Deployment (5) | 1, 8 |
| References FDI/CDI/SDK/plugins (307) | Spread 2–8; **audited in 8.7** |
| Briven mapping notes | All phases |

**If a SuperTokens URL is in the 492 and not covered after Phase 8.7, the plan failed — phase 8 is not OK.**

---

# PART 5 — Process rules (your HIGH VALUE RULE)

1. Do **exactly** what you approve.  
2. **No guess / no assume.**  
3. **No** old Better Auth mixed in as “the product.”  
4. **No DONE** without live proof + **your** OK.  
5. One phase at a time after approve.  
6. Time: **months**, not 8 chat turns.  

---

# PART 6 — What you must answer

Reply with:

```
1. APPROVE 8-phase 100% SuperTokens plan  YES / NO + changes
2. Path A SuperTokens Core under Briven   YES (required for 100%)
3. SMS/phone OTP included                 YES (required for 100%)
4. Start Phase 1 wipe after approve       YES / wait
```

---

# PART 7 — Previous work status

All earlier “Auth complete / Phase 8 complete / SuperTokens depth done” claims are **void**.  
This document is the only plan for **100% SuperTokens as Briven Auth**.

---

## Approval record (2026-07-22)

| Decision | Answer |
|----------|--------|
| 8-phase 100% SuperTokens plan | **YES** |
| Path A SuperTokens Core under Briven | **YES** |
| SMS / phone OTP included | **YES** |
| Wipe old customer Auth (swipe) | **YES** |
| Build while sleeping / auto-build | **YES** |
| **Deploy** | **NO — not until complete Briven Auth is built** |

---

**I am not “done.”** Building all 8 phases locally. Deploy is blocked until the full product is ready and you say ship.

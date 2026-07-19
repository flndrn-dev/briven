# Briven Auth — Professionalization Build Plan

**Goal:** Close the competitive gap with Clerk.com and make Briven Auth a production-grade, professional authentication service for the briven.tech platform.

**Status:** In Progress — Phase 7 Complete

---

## Competitive Context: Briven Auth vs Clerk.com

### Where Briven Auth is already competitive

| Feature | Clerk | Briven Auth |
|---------|-------|-------------|
| Email + password auth | Yes | Yes |
| Social OAuth (12+ providers) | Yes | Yes |
| Magic links | Yes | Yes |
| Email OTP | Yes | Yes |
| TOTP 2FA | Yes | Yes |
| WebAuthn / Passkeys | Yes | Yes |
| Multi-tenant (organizations) | Yes | Yes — custom roles, domain verification, auto-join, membership requests |
| SAML 2.0 SSO | Enterprise plan | Yes — SP-initiated + IdP-initiated, JIT provisioning |
| OIDC Enterprise | Enterprise plan | Yes — start/callback + PKCE polish (S7) |
| User metadata (public/private) | Yes | Yes |
| Multiple emails per user | Yes | Yes |
| Session management (list/revoke) | Yes | Yes — with max lifetime, refresh age, inactivity timeout |
| Sign-in tokens | Yes | Yes |
| Bot protection (Turnstile) | Yes | Yes — tenant-configurable |
| Password breach detection | Yes | Yes — HIBP k-anonymity |
| Rate limiting | Yes | Yes — per-IP + per-email sliding window |
| User bans / suspensions | Yes | Yes |
| Allowlist / blocklist | Yes | Yes — domain + disposable email + subaddress |
| Waitlist mode | Yes | Yes |
| Branded hosted pages | Yes | Yes — custom logo, dark mode, monospace aesthetic |
| Custom auth domains | Yes | Yes |
| Webhooks (event fan-out) | Yes | Yes — HMAC-signed, retry with exponential backoff |
| Audit log | Yes | Yes — privacy-first (IP hash hints only) |
| SDK (React, Vue, Svelte, Vanilla) | Yes | Yes — plus server helpers |
| MAU analytics | Yes | Yes |
| Bulk user import (CSV) | Yes | Yes |
| Dashboard team seats | Yes | Yes — invite team members to manage auth settings |
| User impersonation | Yes | Yes — with audit trail and "stop impersonating" |
| Application logs with retention | Yes | Yes — 7/30/90/365 day tiers |
| Bulk operations (ban/delete/invite) | Yes | Yes — from user table |
| Webhook replay + IP allowlist | Yes | Yes — replay any delivery, restrict IPs |
| Compliance (SOC 2 / HIPAA / GDPR) | Yes | Yes — enterprise trust center groundwork |
| Localization / i18n | Yes | Yes — `locale` in authConfig + SDK support |

### Remaining gaps vs Clerk (Phase 7–9)

| Feature | Clerk | Briven Auth | Plan |
|---------|-------|-------------|------|
| Custom JWT claims / templates | Yes — per-session claim overrides | No — deferred from Phase 3/5 | **Phase 7.1** |
| Profile image / avatar upload | Yes — built-in avatar with Gravatar fallback | No — deferred from Phase 3/6 | **Phase 7.2** |
| Username authentication | Yes — username + password sign-in | No — deferred from Phase 4 | **Phase 7.3** |
| Testing tokens (E2E) | Yes — bypass bot/MFA for test suites | No | **Phase 7.4** |
| Email template customization | Yes — per-tenant HTML/template overrides | No — hardcoded templates only | **Phase 7.5** |
| 2FA backup / recovery codes | Yes — 10 single-use backup codes | No — user can get locked out if TOTP device lost | **Phase 8.1** |
| Device tracking & new-device alerts | Yes — tracks devices, emails on new login | No | **Phase 8.2** |
| Account linking (multi-OAuth → 1 user) | Yes — automatic + manual linking | No — each OAuth creates separate account | **Phase 8.3** |
| Password reset policy | Yes — forced reset, expiration | No — only breach detection | **Phase 8.4** |
| SCIM 2.0 provisioning | Enterprise only | No | **Phase 9** |
| SMS OTP | Yes | Explicitly excluded per project requirements | — |

**Design constraint (repeated):** All UI additions use the existing `briven-auth-*` CSS class convention. Briven's dark monospace minimal aesthetic is preserved. We do not clone Clerk's component visual style.

---

## Sprint Overview

| Sprint | Focus | Duration Estimate | Status |
|--------|-------|------------------|--------|
| **Phase 1** | Security Foundation | 2–3 weeks | **Complete** |
| **Phase 2** | MFA & Session Polish | 1–2 weeks | **Complete** |
| **Phase 3** | User Model & DX | 2 weeks | **Complete** |
| **Phase 4** | Organizations & B2B | 3–4 weeks | **Complete** |
| **Phase 5** | Enterprise SSO | 3–4 weeks | **Complete** |
| **Phase 6** | Dashboard & Compliance | 2–3 weeks | **Complete** |
| **Phase 7** | Developer Experience & Polish | 2 weeks | **Complete** |
| **Phase 8** | Security Hardening & Account Management | 2 weeks | **Planned** |
| **Phase 9** | Enterprise SCIM Provisioning | 2–3 weeks | **Planned** |

---

## Phase 1: Security Foundation (Complete)

**Objective:** Eliminate abuse vectors and bring Briven Auth up to production security standards.

| Task | Status | Notes |
|------|--------|-------|
| 1.1 Bot Protection (Turnstile) | **Done** | Tenant-configurable CAPTCHA on sign-up/sign-in |
| 1.2 Password Breach Detection | **Done** | HIBP k-anonymity check on sign-up |
| 1.3 Rate Limiting | **Done** | Per-IP + per-email sliding window with `Retry-After` |
| 1.4 User Bans / Suspensions | **Done** | `_briven_auth_user_security` auxiliary table |
| 1.5 Allowlist / Blocklist | **Done** | Domain + disposable email + subaddress blocking |
| 1.6 Waitlist Mode | **Done** | `signUpMode: public | restricted | waitlist` |

---

## Phase 2: MFA & Session Polish (Complete)

**Objective:** Close MFA gaps and add production session controls.

| Task | Status | Notes |
|------|--------|-------|
| MFA enforcement (`mfa_required`) | **Done** | Blocks sign-in when MFA not enrolled; passkeys count as MFA |
| Passkeys as MFA | **Done** | Passkey enrollment satisfies the MFA requirement |
| Session max lifetime config | **Done** | `maxLifetimeDays` per tenant (1..3650 days) |
| Session refresh age config | **Done** | `updateAgeDays` per tenant (1..365 days) |
| Session inactivity timeout | **Done** | `inactivityTimeoutMinutes` with `_briven_auth_session_activity` tracking |
| Multi-session (list + revoke) | **Done** | SDK `sessions.list()` / `sessions.revoke()` wired |

---

## Phase 3: User Model & DX (Complete)

**Objective:** Enrich user data model and expand SDK coverage.

| Task | Status | Notes |
|------|--------|-------|
| 3.1 User metadata | **Done** | `public_metadata`, `private_metadata` — backend + endpoints |
| 3.2 Multiple verified emails | **Done** | `_briven_auth_user_emails` auxiliary table |
| 3.3 SDK metadata & emails methods | **Done** | Vanilla SDK `user.getMetadata()`, `user.setMetadata()`, `user.listEmails()`, `user.addEmail()`, `user.removeEmail()` |
| 3.4 Vue SDK package | **Done** | `@briven/auth/vue` subpath with composables + components |
| 3.5 Sign-in tokens | **Done** | Single-use JWT for programmatic session creation |
| 3.6 React SDK metadata hooks | **Pending** | `useUserMetadata`, `useUserEmails` — hooks exist in Vue/Svelte but not React |

**Excluded from Phase 3:**
- SMS/phone infrastructure (explicitly excluded per user request)
- Username authentication (deferred to Phase 7)
- Profile image upload (deferred to Phase 7)
- Custom JWT claims (deferred to Phase 7)
- Svelte SDK (deferred to Phase 6)
- Localization (deferred to Phase 6)

---

## Phase 4: Organizations & B2B (Complete)

**Objective:** Make Briven Auth competitive for B2B multi-tenant SaaS.

| Task | Status | Notes |
|------|--------|-------|
| 4.1 Custom roles & permissions | **Done** | Configurable role + permission system per org; default roles seeded on org creation |
| 4.2 Domain verification | **Done** | `_briven_auth_org_domains` table with verification token + verified_at |
| 4.3 Auto-join from verified domains | **Done** | `maybeAutoJoinOrg()` + `auto_join_enabled` flag per domain |
| 4.4 Membership requests | **Done** | Request-to-join flow with admin approve/reject; `_briven_auth_org_membership_requests` |
| 4.5 Active organization in session | **Done** | `_briven_auth_session_orgs` auxiliary table; org switch without re-auth |
| 4.6 SDK active-org hooks | **Done** | React `useActiveOrganization` + Vue `useActiveOrganization`; updated `OrganizationSwitcher` |

---

## Phase 5: Enterprise SSO (Complete)

**Objective:** Unlock enterprise sales with SAML and OIDC enterprise support.

| Task | Status | Notes |
|------|--------|-------|
| 5.1 SAML 2.0 IdP integration | **Done** | `@node-saml/node-saml` SP; metadata, AuthnRequest, ACS endpoints |
| 5.2 SP-initiated flow | **Done** | `GET /sso/saml/:id` → AuthnRequest → IdP redirect |
| 5.3 IdP-initiated flow | **Done** | `POST /sso/saml/:id/acs` accepts direct IdP SAMLResponse |
| 5.4 OIDC Enterprise foundation | **Done** | Start/callback routes + PKCE S256 + redirectTo (S7 polish) |
| 5.5 JIT provisioning | **Done** | `findOrCreateSsoUser()` auto-creates user on first SSO sign-in when enabled |
| 5.6 Automatic deprovisioning | **Done** | `_briven_auth_sso_sessions` tracks SSO-created sessions; `revokeAllSessionsForConnection()` |
| 5.7 Per-connection pricing hooks | **Pending** | No billing events or metering exist yet |
| 5.8 SDK SSO methods | **Done** | `auth.sso.listConnections()`, `auth.sso.getConnectionByDomain()`, `auth.sso.start()` |

---

## Phase 6: Dashboard & Compliance (Complete)

**Objective:** Build trust through admin collaboration, operational visibility, and compliance groundwork.

| Task | Status | Notes |
|------|--------|-------|
| 6.1 Dashboard team seats | **Done** | `project_auth_team_members` table; `requireAuthTeamAdmin` middleware; list/invite/remove routes |
| 6.2 User impersonation v2 | **Done** | `_briven_auth_impersonation_sessions` tracking; tenant audit log; stop flow; SDK `auth.impersonate.*` |
| 6.3 Application logs with retention | **Done** | `_briven_auth_app_logs` table; `authConfig.retention` (auditLogDays + appLogDays); purge endpoint |
| 6.4 Bulk operations | **Done** | Bulk ban / delete / invite endpoints with per-item result tracking |
| 6.5 Webhook replay + IP allowlist | **Done** | `allowed_ips` on subscribers; replay endpoint; IP/CIDR matching in dispatcher |
| 6.6 Compliance groundwork | **Done** | `_briven_auth_compliance` table; SOC 2 / HIPAA BAA / GDPR DPA metadata endpoints |
| 6.7 Svelte SDK | **Done** | `@briven/auth/svelte` subpath with stores (`createSessionStore`, `createUserStore`, etc.) |
| 6.8 Localization foundation | **Done** | `authConfig.locale`; `locale` param on `hostedPageURL()` and SDK components |

---

## Phase 7: Developer Experience & Polish

**Objective:** Close high-impact DX gaps that Clerk covers out-of-the-box.

| Task | Status | Notes |
|------|--------|-------|
| 7.1 Custom JWT claims / templates | **Done** | `_briven_auth_jwt_templates` + `_briven_auth_custom_jwks`; `auth.jwt.getToken({ template })` SDK method; JWKS endpoint |
| 7.2 Profile image / avatar upload | **Done** | Presigned S3 upload; `auth.user.getAvatarUploadUrl()` + `auth.user.updateAvatar()`; public serve route |
| 7.3 Username authentication | **Done** | `_briven_auth_user_usernames`; `auth.signIn.username()`; `auth.user.setUsername/getUsername/removeUsername()` |
| 7.4 Testing tokens (E2E) | **Done** | `_briven_auth_test_tokens`; admin create/revoke/list; `auth.signIn.testToken()` bypasses all gates |
| 7.5 Email template customization | **Done** | `_briven_auth_email_templates`; admin CRUD; mailer auto-uses custom templates with `{{variable}}` substitution |

---

## Phase 8: Security Hardening & Account Management

**Objective:** Prevent lockouts, detect suspicious access, and allow flexible identity linking.

| Task | Status | Notes |
|------|--------|-------|
| 8.1 2FA backup / recovery codes | **Pending** | `_briven_auth_backup_codes` table; 10 single-use codes; regenerate flow |
| 8.2 Device tracking & new-device alerts | **Pending** | `_briven_auth_devices` table; fingerprint + geo; email alert on unrecognized device |
| 8.3 Account linking (multi-OAuth → 1 user) | **Pending** | `_briven_auth_account_links` table; manual + automatic linking flows |
| 8.4 Password reset policy | **Pending** | `_briven_auth_password_policy` table; forced reset, expiration, history |

---

## Phase 9: Enterprise SCIM Provisioning

**Objective:** Close the final enterprise gap with automated user lifecycle management.

| Task | Status | Notes |
|------|--------|-------|
| 9.1 SCIM 2.0 user provisioning | **Done** (2026-07-19) | `/v1/projects/:id/scim/v2/Users` CRUD; `_briven_auth_scim_users` |
| 9.2 SCIM group → org role mapping | **Done** (2026-07-19) | `…/auth/scim/role-maps` + apply on Group create |
| 9.3 SCIM sync endpoints | **Done** (bearer push) | `scim_briven_…` tokens; docs/SCIM.md |
| 9.4 Enterprise compliance sales kit | **Done** (2026-07-19) | `…/compliance/pack`, sign-dpa/baa, trust page, docs/ENTERPRISE-PACK.md |

---

## Architecture Principles

1. **Minimal changes** — Scope edits to files the request implies. No opportunistic cleanup.
2. **Match existing style** — Follow the project's naming, comment density, and structural idioms.
3. **Better Auth foundation** — All changes extend the existing Better Auth + Drizzle architecture.
4. **Per-tenant config** — All features are tenant-configurable where applicable.
5. **Privacy first** — No IP tracking, PII redaction in admin views, GDPR compliance.
6. **Test what you build** — Verify changes before marking done.
7. **Never ALTER existing tables** — Use auxiliary tables (DoltGres constraint).
8. **Preserve Briven UI/UX** — All SDK components use the existing `briven-auth-*` CSS class convention; no Clerk UI cloning.

---

## Gap Fix Sprint (Critical + High)

**Objective:** Fix all production-blockers and security gaps identified in the post-Phase-7 audit before continuing with Phase 8.

| Order | Gap | Severity | Fix |
|-------|-----|----------|-----|
| 1 | Session inactivity timeout is bypassable | **Critical** | Move `checkSessionActivity` out of the `eligible` gate so it runs on **every** authenticated request |
| 2 | Passkey `rpID` hardcoded to `briven.tech` | **Critical** | Derive `rpID` from `customAuthDomain` or request origin |
| 3 | OIDC Enterprise flow completely missing | **Critical** | Build `/sso/oidc/:id` start + callback endpoints; update SDK `sso.start()` to branch by `providerType` |
| 4 | OAuth account linking (multi-OAuth → 1 user) | **Critical** | `_briven_auth_account_links` table; auto-link on matching email; manual link API |
| 5 | 2FA backup codes missing | **Critical** | `_briven_auth_backup_codes` table; generate/verify/regenerate flows; wire into sign-in |
| 6 | Device tracking is dead code | **Critical** | `_briven_auth_devices` table; fingerprint on sign-in; `sendBrivenAuthNewDeviceLogin()` wired |
| 7 | Rate limiting is in-memory only | **Critical** | Add Redis-backed store when `BRIVEN_REDIS_URL` is available; fallback to in-memory |
| 8 | Email normalization (Gmail dots, plus aliases) | High | Strip dots and `+` aliases from Gmail before blocklist/allowlist checks |
| 9 | Domain verification is "blind" | High | Add DNS TXT record challenge validation to `verifyOrgDomain()` |
| 10 | SAML RelayState not validated | High | Validate `RelayState` against project's registered app origins before redirect |
| 11 | SDK publicKey scopes not enforced | High | Add middleware to validate `Authorization: Bearer <publicKey>` on auth-tenant routes |
| 12 | Admin cannot revoke specific session | High | Add `POST /v1/projects/:id/auth/users/:userId/sessions/:sessionId/revoke` admin route |
| 13 | Password reset policy missing | High | `_briven_auth_password_policy` table; enforce on sign-in; admin config endpoints |
| 14 | SCIM provisioning missing | High | Phase 9.1/9.3 shipped 2026-07-19; 9.2 deep org map later |
| 15 | GDPR data export missing | High | Add data export endpoint before user deletion |
| 16 | React SDK metadata hooks missing | High | Add `useUserMetadata` + `useUserEmails` to React SDK |

### Build plan corrections

| Claim | Correction |
|-------|------------|
| 5.4 OIDC Enterprise — "Done" | Confirmed shipped + S7 PKCE polish |
| 3.6 React SDK metadata hooks — "Done" | Reverted to **Pending** — hooks do not exist in React SDK |
| 5.7 Per-connection pricing hooks — "Done" | Reverted to **Pending** — no billing events or metering exist |

---

## Current Sprint: Phase 8 — Security Hardening & Account Management

| Task | Status | Notes |
|------|--------|-------|
| 8.1 2FA backup / recovery codes | **Pending** | `_briven_auth_backup_codes` table; 10 single-use codes; regenerate flow |
| 8.2 Device tracking & new-device alerts | **Pending** | `_briven_auth_devices` table; fingerprint + geo; email alert on unrecognized device |
| 8.3 Account linking (multi-OAuth → 1 user) | **Pending** | `_briven_auth_account_links` table; manual + automatic linking flows |
| 8.4 Password reset policy | **Pending** | `_briven_auth_password_policy` table; forced reset, expiration, history |

# Briven Auth — Professionalization Build Plan

**Goal:** Close the competitive gap with Clerk.com and make Briven Auth a production-grade, professional authentication service for the briven.tech platform.

**Status:** **Complete** — Phases 1–9 + gap-fix sprint closed (2026-07-22). Auth v2 yellow product surface + engine packaging live.

---

## Competitive Context: Briven Auth vs Clerk.com

### Where Briven Auth is competitive

| Feature | Clerk | Briven Auth |
|---------|-------|-------------|
| Email + password auth | Yes | Yes |
| Social OAuth (12+ providers) | Yes | Yes |
| Magic links | Yes | Yes |
| Email OTP | Yes | Yes |
| TOTP 2FA | Yes | Yes |
| WebAuthn / Passkeys | Yes | Yes |
| Multi-tenant (organizations) | Yes | Yes |
| SAML 2.0 SSO | Enterprise | Yes |
| OIDC Enterprise | Enterprise | Yes |
| User metadata | Yes | Yes |
| Multiple emails | Yes | Yes |
| Session management | Yes | Yes |
| Sign-in tokens | Yes | Yes |
| Bot protection | Yes | Yes |
| Password breach detection | Yes | Yes |
| Rate limiting | Yes | Yes (Redis when configured, memory fallback) |
| Bans / suspensions | Yes | Yes |
| Allowlist / blocklist | Yes | Yes |
| Waitlist mode | Yes | Yes |
| Branded hosted pages | Yes | Yes — yellow **branding** UI |
| Custom auth domains | Yes | Yes |
| Webhooks | Yes | Yes |
| Audit log | Yes | Yes |
| SDK (React, Vue, Svelte, Vanilla) | Yes | Yes |
| MAU analytics | Yes | Yes |
| Bulk user import | Yes | Yes |
| Dashboard team seats | Yes | Yes |
| User impersonation | Yes | Yes |
| Application logs | Yes | Yes |
| Bulk operations | Yes | Yes |
| Compliance groundwork | Yes | Yes |
| Localization | Yes | Yes |
| Custom JWT templates | Yes | Yes |
| Profile avatar | Yes | Yes |
| Username auth | Yes | Yes |
| Testing tokens (E2E) | Yes | Yes |
| Email templates | Yes | Yes |
| 2FA backup codes | Yes | Yes — 10 codes + Security UI |
| Device tracking | Yes | Yes — engine + Users / Sessions UI |
| Account linking | Yes | Yes — auto + unlink UI |
| Password policy / force reset | Yes | Yes — Security UI |
| SCIM 2.0 | Enterprise | Yes |
| Per-connection SSO metering | Enterprise | Yes — Phase 5.7 usage_events + Polar hooks |
| SMS OTP | Yes | Explicitly excluded |

**Design constraint:** `briven-auth-*` CSS; dark monospace aesthetic; no Clerk UI cloning.

---

## Sprint Overview

| Sprint | Focus | Status |
|--------|-------|--------|
| **Phase 1** | Security Foundation | **Complete** |
| **Phase 2** | MFA & Session Polish | **Complete** |
| **Phase 3** | User Model & DX | **Complete** (3.6 React hooks shipped) |
| **Phase 4** | Organizations & B2B | **Complete** |
| **Phase 5** | Enterprise SSO | **Complete** (5.7 metering shipped 2026-07-22) |
| **Phase 6** | Dashboard & Compliance | **Complete** |
| **Phase 7** | Developer Experience & Polish | **Complete** |
| **Phase 8** | Security Hardening & Account Management | **Complete** |
| **Phase 9** | Enterprise SCIM Provisioning | **Complete** |
| **Auth v2 product** | Yellow Authentication sub-dashboard | **Complete** (config surface; runtime still auth-tenant) |

---

## Phase details (summary)

Phases 1–9 task tables remain historically accurate as **Done**. Notable late closes:

| Item | Close date | Notes |
|------|------------|-------|
| 3.6 React `useUserMetadata` / `useUserEmails` | earlier | `packages/auth/src/react/index.ts` |
| 5.7 Per-connection pricing hooks | 2026-07-22 | `auth_sso_connections` + `auth_sso_signins` usage metrics; wire on SSO create/sign-in; aggregator + Polar optional meters |
| 8.1–8.4 | 2026-07-22 | Yellow Security / Users / Sessions UIs |
| Auth v2 branding + enterprise tabs | 2026-07-22 | `/dashboard/auth/branding`, `/dashboard/auth/enterprise` |

---

## Gap Fix Sprint — closed

| Order | Gap | Status |
|-------|-----|--------|
| 1 | Session inactivity bypassable | **Done** — checked on every authenticated auth-tenant request; UI under Security |
| 2 | Passkey rpID hardcoded | **Done** — `resolvePasskeyRpId` |
| 3 | OIDC Enterprise missing | **Done** — start/callback routes + SDK branch |
| 4 | OAuth account linking | **Done** — auto-link + Users unlink UI |
| 5 | 2FA backup codes | **Done** — Better Auth twoFactor amount 10 + Security UI |
| 6 | Device tracking dead | **Done** — wired on sign-in + Users/Sessions UI |
| 7 | Rate limit in-memory only | **Done** — Redis when `BRIVEN_REDIS_URL` set |
| 8 | Gmail email normalization | **Done** — `normalizeEmail` |
| 9 | Domain verification blind | **Done** — DNS TXT via `verifyOrgDomain` |
| 10 | SAML RelayState | **Done** — `sanitizeRelayState` on ACS path |
| 11 | SDK publicKey scopes | **Done** — `sdkKeyAllowsMethod` on tenant bridge |
| 12 | Admin revoke session | **Done** — route + Users/Sessions UI |
| 13 | Password reset policy | **Done** — table + Security UI + force-reset |
| 14 | SCIM | **Done** — Phase 9 |
| 15 | GDPR export | **Done** — `exportUserData` |
| 16 | React metadata hooks | **Done** — React SDK |

### Build plan corrections (resolved)

| Claim | Resolution |
|-------|------------|
| 5.4 OIDC Enterprise | Shipped |
| 3.6 React metadata hooks | Shipped in React SDK |
| 5.7 Per-connection pricing | Shipped 2026-07-22 |

---

## Auth v2 product surface (yellow Authentication)

| Tab | Role |
|-----|------|
| overview | Phase status + links |
| projects | Enable Auth |
| providers | Passwordless/password methods + save-proof |
| security | 2FA, password rules, session inactivity |
| branding | Logo, color, email from name |
| enterprise | SSO connections (SAML/OIDC) + metering note |
| users | Redacted list + linked logins + devices + sessions |
| sessions & devices | Per-user device/session admin |
| keys | `pk_briven_auth_…` |
| domains | Allowed origins |

Runtime login remains `/v1/auth-tenant` (Better Auth pool) until a future full core rewrite. Config and admin are first-class on the yellow dashboard.

---

## Architecture Principles

1. Minimal changes; match existing style.
2. Better Auth foundation; extend, don't invent Clerk.
3. Per-tenant config; privacy-first (no raw IPs in admin).
4. Never ALTER existing tables — auxiliary tables only (DoltGres).
5. Test what you build; batch deploys to France from local when Konnos lag.

---

## Explicit non-goals

- SMS OTP
- Full SuperTokens Java Core self-host for customers
- Replacing Better Auth runtime in this close-out (Auth v2 packaging only)

---

## Next (optional future)

- Polar meter UUIDs in production env for `auth_sso_*` (optional; rows skip until set)
- Deeper IdP metadata wizards in enterprise UI
- First-party app-domain proxy scaffold docs polish in HANDOFF
- Full engine swap away from Better Auth (only if product still requires it)

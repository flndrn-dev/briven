# Sprint Plan: Critical & High Gap Fixes

**Sprint Goal:** Fix all production-blockers and high-severity gaps identified in the post-Phase-7 audit before resuming regular feature work (Phase 8+).

**Constraint:** No SMS infrastructure (excluded per project requirements). Preserve existing Briven UI/UX design. All new UI uses `briven-auth-*` CSS class convention.

---

## Already Done

| # | Gap | Fix | Status |
|---|-----|-----|--------|
| 1 | Session inactivity timeout bypassable | Moved `checkSessionActivity` to bridge handler so it runs on every authenticated request | Done |
| 2 | Passkey `rpID` hardcoded to `briven.tech` | Derive `rpID` from `customAuthDomain` or request origin | Done |
| 3 | OIDC Enterprise flow missing | Built `/sso/oidc/:id` start + callback endpoints; updated SDK `sso.start()` to branch by `providerType` | Done |
| 4 | OAuth account linking (multi-OAuth → 1 user) | `auth-account-linking.ts` service with auto-link on matching email; admin route; SDK `user.listAccounts()` | Done |

---

## Remaining Work (in order)

### Critical Gaps

| # | Gap | Fix | File Targets |
|---|-----|-----|--------------|
| 5 | 2FA backup codes missing | `_briven_auth_backup_codes` table; generate/verify/regenerate flows; wire into sign-in | `auth-customer-schema.ts`, `auth-service.ts`, `packages/auth/src/index.ts` |
| 6 | Device tracking is dead code | `_briven_auth_devices` table; fingerprint on sign-in; wire `sendBrivenAuthNewDeviceLogin()` | `auth-customer-schema.ts`, `auth-service.ts`, mailer service |
| 7 | Rate limiting in-memory only | Redis-backed store when `BRIVEN_REDIS_URL` available; fallback to in-memory | `auth-service.ts` or new `auth-rate-limit.ts` |

### High Gaps

| # | Gap | Fix | File Targets |
|---|-----|-----|--------------|
| 8 | Email normalization missing (Gmail dots, plus aliases) | Strip dots and `+` aliases from Gmail before blocklist/allowlist checks | `auth-service.ts` (sign-up / sign-in gates) |
| 9 | Domain verification is "blind" | Add DNS TXT record challenge validation to `verifyOrgDomain()` | `auth-service.ts` (org domain routes) |
| 10 | SAML RelayState not validated | Validate `RelayState` against project's registered app origins before redirect | `auth-sso.ts` |
| 11 | SDK publicKey scopes not enforced | Add middleware to validate `Authorization: Bearer <publicKey>` on auth-tenant routes | `auth-service.ts` (bridge middleware) |
| 12 | Admin cannot revoke specific session | Add `POST /v1/projects/:id/auth/users/:userId/sessions/:sessionId/revoke` admin route | `auth-service.ts` |
| 13 | Password reset policy missing | `_briven_auth_password_policy` table; enforce on sign-in; admin config endpoints | `auth-customer-schema.ts`, `auth-service.ts` |
| 14 | SCIM provisioning missing | Phase 9 — deferred until after this sprint | — |
| 15 | GDPR data export missing | Add data export endpoint before user deletion | `auth-service.ts` |
| 16 | React SDK metadata hooks missing | Add `useUserMetadata` + `useUserEmails` to React SDK | `packages/auth/src/react/` |

---

## Build Plan Corrections

| Claim | Correction |
|-------|------------|
| 5.4 OIDC Enterprise — "Done" | Only table column exists; flow built in this sprint |
| 3.6 React SDK metadata hooks — "Done" | Hooks do not exist in React SDK; will be added in this sprint |
| 5.7 Per-connection pricing hooks — "Done" | No billing events or metering exist; remains pending |

---

## Definition of Done

- [ ] All critical gaps (#1–#7) are fixed, type-checked, and tested locally.
- [ ] All high gaps (#8–#16, except #14 deferred) are fixed, type-checked, and tested locally.
- [ ] `pnpm --filter @briven/api typecheck` passes.
- [ ] `pnpm --filter @briven/auth typecheck` passes.
- [ ] All changes are committed to `main` and pushed to the repo.
- [ ] `build_plan.md` is updated to reflect corrected statuses.

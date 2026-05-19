# briven auth — launch-readiness review

> **Phase:** BUILD_PLAN.md §13 step 14 (2 d).
> **Owner:** J personally. No phase transition without explicit sign-off per
> `road-to-ga.md` "Notes" — implicit silence does not count.
>
> Walk through every box below in order. Each unchecked box is a release
> blocker. Capture evidence inline; this document becomes the body of
> ADR-0016 on close-out.

---

## 1. Engine / multi-tenant (BUILD_PLAN.md §14)

- [ ] One Better Auth instance per project, lazily instantiated, cached,
      evicted after 10 minutes idle.
      → `apps/api/src/services/auth-tenant-pool.ts` + verify pool size via
      `/v1/realtime/stats`-equivalent admin endpoint.
- [ ] Tenant-isolation pen test passes 100 % — every probe in
      `apps/api/src/services/auth-tenant-isolation.test.ts` returns 401/403/404.
      Run with `BRIVEN_PEN_TEST_RUN=1` after staging deploy.
- [ ] Per-tenant encrypted secret store: encrypting in tenant A's context
      cannot read tenant B's ciphertext.
      → `apps/api/src/services/tenant-secret-store.test.ts` green.
- [ ] Master-key rotation procedure documented + tested on a staging tenant.

## 2. Auth flows (BUILD_PLAN.md §14)

- [ ] **OAuth — Google, GitHub, Discord, Microsoft.** Sign-in completes and
      writes a row in `_briven_auth_users` + `_briven_auth_accounts`. Replay
      attack (re-use of `code`) returns 400.
- [ ] **Magic link.** Request returns 200 regardless of email existence
      (enumeration defence). Click completes sign-in. Link is one-shot
      (consume marks `consumed_at`). Expired link returns 410.
- [ ] **Email OTP.** 6-digit code, 5-minute expiry, max 5 attempts per code
      (then invalidate), constant-time comparison.
- [ ] **Passkey.** Register + authenticate on Chrome, Safari, Firefox (latest
      two versions each). Cross-origin / cross-RPID attempts rejected.
- [ ] **Sessions.** `/v1/auth/session` reflects current state in < 50 ms p50
      from cache, < 300 ms p99 from cold.

## 3. Dashboard (BUILD_PLAN.md §14)

- [ ] All 8 sub-routes render with seeded data in < 500 ms p50:
      `overview, providers, branding, users, audit, api-keys, webhooks, usage`.
- [ ] User list never echoes a full email. Search by full email works
      (server-side hash compare).
- [ ] Audit-log filters apply server-side, paginated, no client-side
      full-table load.
- [ ] Branding upload: max 256 KB, server-side resize, WCAG-AA contrast
      check on primary color picker.

## 4. SDK + components (BUILD_PLAN.md §14)

- [ ] `npm install @briven/auth` against a clean Next.js 16 project
      succeeds with zero peer-dep warnings (react + react-dom marked
      optional in `packages/auth/package.json`).
- [ ] Quickstart timed end-to-end (clean machine → user signed in via
      passkey in their app) in ≤ 5 minutes.
      → walk `docs/auth-quickstart.md` from scratch on a clean profile.
- [ ] Bundle size: `<BrivenSignIn />` gzipped < 35 KB.
      → CI bundle-size check (deferred from step 7; lands here).
- [ ] Zero `any` in `packages/auth/src/`.
      → `pnpm --filter @briven/auth typecheck` + `grep -rn ": any" packages/auth/src/`.

## 5. Email (BUILD_PLAN.md §14)

- [ ] Five templates render correctly on Gmail, Apple Mail, Outlook
      (web + native), and one mobile client.
      → magic-link, OTP, email-verify, password-reset, new-device-login.
- [ ] Sender-domain verification wizard completes within one DNS-propagation
      cycle for > 95 % of customers.
- [ ] Deliverability ≥ 97 % inbox placement on verified-domain sends.

## 6. Billing (BUILD_PLAN.md §14)

- [ ] MAU counter correct within ±1 user against a hand-counted ground-truth
      sample of 10k users.
      → run `getAuthMauStats` against a staging tenant with seeded
      `_briven_auth_sessions` rows; diff against
      `SELECT count(distinct user_id) FROM _briven_auth_sessions WHERE created_at > now() - interval '30 days'`.
- [ ] Soft + hard cap behave as specified: free tier blocks sign-up at the
      ceiling; pro + team meter overage to Polar.
- [ ] Polar push pipeline drains `usage_events.metric='auth_mau'` rows.
      → `BRIVEN_POLAR_METER_AUTH_MAU_ID` configured; check
      `apps/api/src/workers/polar-meter-push.ts` logs for `polar_push_pushed`.

## 7. Migration (BUILD_PLAN.md §14)

- [ ] djstudio migration: zero P0/P1 incidents during the 7-day soak.
      → see `docs/runbooks/auth-djstudio-migration.md` exit criteria.
- [ ] Better Auth import script transforms 100k users in < 10 minutes.
      → time the production import in step 4.4 of the runbook against a
      pre-seeded 100k-row CSV in staging.

## 8. Privacy (BUILD_PLAN.md §14)

- [ ] No email in any list response, audit log entry, log line, or error
      message — verified by a grep + a content-security test that fuzzes
      the API for emails and asserts they never appear in responses.
      → unit suite in `auth-tenant-isolation.test.ts` covers redaction;
      extend with response-fuzz test before close-out.
- [ ] No raw IP — same gating.
      → `apps/api/src/db/auth-customer-schema.ts:ipAddressHash` is the only
      column that touches IP data; verify there is no other place a raw
      IP could land via `grep -rn "ip_address[^_]" apps/api/src/`.

## 9. Docs (BUILD_PLAN.md §14)

- [ ] Quickstart copy-pasted into a fresh repo by an outside engineer
      produces a working sign-in in ≤ 10 minutes.
      → recruit one external operator for this single test (same operator
      who validates the self-host install in `road-to-ga.md` §4.3 is a
      natural fit).

## 10. Forward-compatibility (BUILD_PLAN.md §14)

- [ ] `ARCHITECTURE.md` enumerates every reuse point with file paths.
- [ ] A "briven pay scaffolding test" — a noop second-service registration —
      runs against the multi-tenant layer and proves the second service can
      mount without code changes to the auth code paths.

## 11. Operational (cross-cutting)

- [ ] `BRIVEN_AUTH_ENABLED=true` set in production Dokploy env. Kill-switch
      verified by toggling false on a staging deploy and confirming
      `/v1/auth-service/health` reports `disabled`.
- [ ] Alertmanager → `#briven-alerts` rule wired for any 5xx burst from
      `/v1/auth*` paths. Smoke-tested per `docs/runbooks/discord-setup.md` §10.
- [ ] Backup proves restorable: a one-time restore drill against the most
      recent off-site dump completes successfully. See
      `infra/backups/restore-drill.sh`.

## 12. Release artefacts (final 30 min)

- [ ] `road-to-ga.md` reflects the truth: every code-side §0–§3 box ticked
      with evidence; J-side items left open until their evidence lands.
- [ ] ADR-0015 (`djstudio-auth-dogfood-closeout.md`) re-statused
      `draft` → `accepted` with deploy hash + timestamp.
- [ ] ADR-0016 (`auth-v1-launch-closeout.md`) created with this document
      as the body + the operator's sign-off line.
- [ ] Git tag `auth/v1.0.0` on `main`. Commit message references this
      checklist and the closed ADRs.
- [ ] Status page incident "briven auth v1 GA" published.
- [ ] Launch tweet drafted (briven.tech / J's personal handle / HN show
      copy) — actual posting timed for low-noise window (Tue 14:00 UTC).

---

## Sign-off

When every box above is `[x]` with evidence captured inline:

> Phase v1 approved.
>
> J — <date> <time> UTC

Per `road-to-ga.md` "Notes": the named phase + explicit "approved" line is
required. "ok" / emoji / silence is **not** sign-off. Without this exact
line, no `[ ]→[x]` flip lands in `road-to-ga.md` and no ADR re-status from
`draft` to `accepted` happens.

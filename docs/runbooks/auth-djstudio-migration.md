# Runbook — djstudio migration off Better Auth onto briven auth

> **Phase:** BUILD_PLAN.md §13 step 12 (dogfooding migration).
> **Owner:** J. Claude may not run the live cutover — it touches the production
> djstudio database.
> **Pre-req:** briven auth steps 1–11 closed; staging tenant for djstudio
> provisioned; pen test (`auth-tenant-isolation.test.ts`) green against staging.

---

## Goal

Move djstudio's authenticated users from its existing Better Auth control-plane
install onto briven auth, with zero P0/P1 incidents during a 7-day soak.

After cutover, every djstudio user logs in via `auth.briven.tech/djstudio/sign-in`
(or the legacy app URL if djstudio fronts a custom domain), lands in
`proj_<djstudio-project-id>._briven_auth_users`, and is joinable against
djstudio's own tables (`tracks.created_by`, etc.).

## Why this is the dogfood target

djstudio is non-regulated, low-traffic, J-owned. Same operator on both sides of
the migration, so a P1 doesn't take down a paying customer. Mavi Finans —
regulated fintech — only migrates after 60+ continuous clean uptime days
across this and the videodj cutover (`road-to-ga.md` §3.10).

## Pre-flight (one-time)

- [ ] **djstudio project enabled for auth.** From the briven dashboard:
      `/dashboard/projects/<djstudio>/auth` → click **Enable auth**. Verify
      the five `_briven_auth_*` tables landed via
      `/dashboard/projects/<djstudio>/studio/<table>` browse.
- [ ] **SDK key minted.** `/auth/api-keys` → create `production web` key with
      scope `read-write`. Copy plaintext, paste into djstudio's `.env` as
      `BRIVEN_AUTH_PUBLIC_KEY`. (Plaintext never reappears — store it in 1Password.)
- [ ] **OAuth providers wired.** Reuse djstudio's existing Google + GitHub
      client ids — paste into `/auth/providers`. Test-connection button proves
      the encrypted-secret round-trips.
- [ ] **Sender domain verified.** `/auth/branding` → sender-domain wizard for
      `noreply@djstudio.tech`. SPF/DKIM cycle takes < 1 DNS-propagation
      window for ≥ 95 % of customers (BUILD_PLAN.md §14 acceptance).
- [ ] **Test sign-up.** From a fresh browser profile go to
      `/auth/<djstudio>/sign-up` and create `pen-test-1@djstudio.tech`.
      Verify the row in `_briven_auth_users` shows the expected `created_at`
      and the user receives the verification email.

## Migration step 1 — export from Better Auth (read-only)

On a staging copy of djstudio's database:

```bash
psql <djstudio-staging-dsn> -c "\
  COPY (
    SELECT u.id, u.email, u.name,
           u.email_verified::timestamptz AS email_verified,
           a.password AS password_hash
    FROM \"user\" u
    LEFT JOIN account a
      ON a.user_id = u.id AND a.provider_id = 'credential'
    ORDER BY u.created_at
  ) TO STDOUT WITH (FORMAT CSV, HEADER true);
" > djstudio-users.csv
```

The export is **read-only** — Better Auth keeps serving until the cutover.
Bcrypt hashes will dominate the export (Better Auth's pre-argon2id default in
the version djstudio runs); briven auth's import accepts them and upgrades
on the next successful sign-in (BUILD_PLAN.md §10 hash compatibility).

## Migration step 2 — dry-run import against the staging tenant

```bash
curl -X POST https://api.briven.tech/v1/projects/<djstudio>/auth/import \
  -H "authorization: Bearer <dashboard-session-cookie>" \
  -H "content-type: text/csv" \
  --data-binary @djstudio-users.csv
```

Expected response shape:

```json
{ "inserted": <N>, "skipped": 0, "errors": [] }
```

If `errors[]` is non-empty, fix the offending rows in the CSV and re-run
**against staging only** (idempotent — existing emails skip). Do NOT touch
production until errors is `[]` on a clean dry-run.

Capture in this runbook:

- staging `inserted` count → ___
- timestamp of the dry-run → ___

## Migration step 3 — schedule the cutover

- [ ] Pick a low-traffic Sunday 02:00 UTC.
- [ ] Pre-announce 7 days ahead via djstudio's `/changelog` page and the
      djstudio Discord `#announcements` channel.
- [ ] Status page incident "scheduled maintenance" opens 1 hour before cutover.
      Closes when the 7-day soak ends green.

## Migration step 4 — cutover (T-0 to T+30m)

1. **Freeze writes.** Set djstudio behind a 503 + maintenance page. Cookie
   sessions stay valid for read endpoints; writes block.
2. **Final export.** Re-run the export query from step 1 against the live
   djstudio db; capture a fresh CSV.
3. **Snapshot the production briven control DB.** `infra/backups/briven-backup.sh`
   one-shot run; capture local + off-site sha256 in this runbook.
4. **Production import.**
   ```bash
   curl -X POST https://api.briven.tech/v1/projects/<djstudio>/auth/import \
     -H "authorization: Bearer <prod-dashboard-cookie>" \
     -H "content-type: text/csv" \
     --data-binary @djstudio-users-final.csv
   ```
   - `inserted` count → ___
   - `skipped` count → ___ (should equal the test users from step 1 / staging)
5. **Cut DNS.** djstudio's app deploys with `BRIVEN_AUTH_PUBLIC_KEY` pointed at
   the production briven api. The Better Auth control-plane install is *not*
   torn down yet — kept warm as a rollback target for 24h.
6. **Unfreeze writes.** Maintenance mode off. Status page transitions
   "monitoring".
7. **Smoke test.** From two browser profiles:
   - Existing user signs in with email + password → lands in
     `_briven_auth_users`; `password_hash` mid-flight transparently
     upgrades bcrypt → argon2id.
   - New user signs up via Google OAuth → row + linked account land.
   - Magic-link flow round-trips (BUILD_PLAN.md §14 deliverability ≥ 97 %
     target — first send should arrive in < 60s).
8. **Capture the green deploy hash** in this runbook → ___

## Migration step 5 — soak (T+30m to T+7d)

- [ ] Daily checklist for 7 consecutive days:
  - `/v1/projects/<djstudio>/auth/mau` returns the expected MAU range
  - `briven_realtime_reinvoke_total{outcome="ok"}` keeps rising
  - Alertmanager → `#briven-alerts` quiet for 24h running
  - djstudio Discord `#bugs` channel: zero auth-related reports

- [ ] Two scheduled rollback rehearsals during the soak:
  - **Rehearsal 1** (T+1d): bring the legacy Better Auth control-plane install
    back online in a *staging* djstudio environment from the snapshot in
    step 4.3. Verify a frozen-cookie sign-in still completes there. Confirm
    rollback ETA ≤ 30 min.
  - **Rehearsal 2** (T+4d): repeat against a different snapshot to confirm
    the rehearsal isn't tooling-coincidence.

## Migration step 6 — close-out (T+7d)

- [ ] Soak green. Status page incident closes "complete".
- [ ] `MIGRATION.md` lessons-learned section appended (BUILD_PLAN.md §10
      "Dogfooding" exit criterion).
- [ ] Legacy Better Auth control-plane install for djstudio is decommissioned —
      tables dropped, traffic confirmed zero for 7 days.
- [ ] `road-to-ga.md` §2.4-style entry added (this is NOT 2.4 itself — that's
      videodj — but the format is identical; copy-paste, capture deploy id +
      timestamps, mark `[x]` only after J personally signs off).

## Rollback

If any of the smoke tests in step 4.7 fail OR the soak hits a P0/P1:

1. **Re-freeze** djstudio writes.
2. Flip `BRIVEN_AUTH_PUBLIC_KEY` back to the legacy Better Auth install env.
3. Re-deploy djstudio.
4. Status page: "rollback complete; investigating".
5. Capture the rollback reason in this runbook so the next attempt avoids it.

The briven auth tables stay populated — a future re-attempt re-imports from
the same CSV (idempotent skip-by-email). Do NOT drop the
`_briven_auth_*` tables on rollback; the column-level data is the operator's
forensic trail.

## Exit criteria (BUILD_PLAN.md §14 acceptance gate)

- [ ] Zero P0/P1 incidents during the 7-day soak.
- [ ] Better Auth → briven auth transformation runs < 10 minutes for 100k users
      (proxy for djstudio's smaller user base; check timing of step 4.4 import).
- [ ] Rollback plan rehearsed twice.
- [ ] `MIGRATION.md` updated with djstudio lessons-learned section.

When every box is `[x]` with evidence, J flips the corresponding row in
`road-to-ga.md` and the ADR `0015-djstudio-auth-dogfood-closeout.md` lands as
`accepted` with timestamp + deploy hash.

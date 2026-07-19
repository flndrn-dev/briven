# Phase 0 — Foundations close-out

**Rule (hard):** each phase is only **Done** or **Not done**.  
No “mostly”, “partial”, or skipping ahead.  
**Status as of audit 2026-07-19: Phase 0 = Not done.**

Source checklist: platform plan (`docs/archive/road-to-ga.md` Phase 0).  
Work ethic: finish every box with **real proof**, then open Phase 1.

---

## Exit criterion (all must be true)

Nightly cold-storage backup confirmed off-site (R2/B2) **and** alerts route to Discord **and** trademark filing evidenced **and** this file marks every task **Done**.

---

## Task board

| # | Task | Status | Proof / gap (2026-07-19) |
| --- | --- | --- | --- |
| **0.1** | Off-site backup target (R2/B2) | **Not done** | France `briven-backup.timer` **failed since 2026-05-13** (Result: resources). Last service success 2026-05-12. No files under `/var/backups/briven`. Host script still targeted container `briven-postgres-1` (gone). Live control DB is `briven-brivenfrance-uilsk6-postgres-1` / DB `briven_control`. Data plane has local `dolt-backup` loop only (file volume, not off-site). `/etc/briven/backup.env` has **no** `BRIVEN_BACKUP_S3_*` keys — off-site upload cannot run. |
| **0.2** | Discord webhooks (alerts + deploys) | **Not done** | Alert unit code exists in repo; live `briven-backup.service` has **no** `OnFailure=briven-backup-alert.service`. No evidence of synthetic Discord smoke tests (§10) succeeding. Webhook URLs not confirmed configured in observability env. |
| **0.3** | Trademark filing EU + Benelux | **Not done** | Plan once checked `[x]`, but verify rule requires **filing reference numbers committed** under `docs/legal/trademark/`. That path **does not exist** in the working tree → cannot claim Done. |
| **0.4** | Phase 0 sign-off (ADR + status closed) | **Not done** | Blocked until 0.1–0.3 are Done. No Phase 0 close-out ADR. |

---

## Agent work in progress (does not mark phase Done)

| Action | Intent |
| --- | --- |
| Repair backup script + systemd units on France | Restore **local** daily control-plane dumps + failure alerting hook |
| Reset failed timer | Stop “timer dead for 2 months” |
| Keep this file honest | Only flip **Done** when verify steps pass |

---

## What only flndrn can provide (blocks Done)

1. **0.1** — B2 or R2 bucket + access key + secret → put into `/etc/briven/backup.env` as `BRIVEN_BACKUP_S3_ENDPOINT`, `BRIVEN_BACKUP_S3_BUCKET`, `BRIVEN_BACKUP_S3_ACCESS_KEY`, `BRIVEN_BACKUP_S3_SECRET_KEY`. Then re-run backup and confirm object + sha256 match.  
2. **0.2** — Discord webhooks for `#briven-alerts` and `#briven-deploys` → set `BRIVEN_DISCORD_WEBHOOK_ALERTS` / `BRIVEN_DISCORD_WEBHOOK_DEPLOYS` (and observability stack). Smoke-test without killing production.  
3. **0.3** — Trademark filing receipts / reference numbers (or explicit “not filed; remove from Phase 0” decision).

---

## When Phase 0 becomes Done

Every row above is **Done** with command output or committed evidence linked here.  
**Only then** open Phase 1 (MVP engine / realtime close-out). Do not build Phase 1+ features under this gate.

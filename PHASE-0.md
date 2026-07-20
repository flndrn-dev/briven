# Phase 0 — Foundations close-out

**Rule (hard):** each phase is only **Done** or **Not done**.  
No “mostly”, “partial”, or skipping ahead.  
**Status as of 2026-07-19 evening: Phase 0 = Not done** (only **0.1 off-site S3** still required for engineering close).

**Master queue:** `BUILD-GAPS.md`.  
**Off-site handoff:** `infra/backups/BACKUP-OFFSITE.md`.

---

## Exit criterion (engineering)

Nightly control-plane dump **and** off-site upload OK.  
Discord + trademark are **not** engineering gates.

---

## Task board

| # | Task | Status | Proof / gap (2026-07-19) |
| --- | --- | --- | --- |
| **0.1** | Off-site backup target (R2/B2) | **Not done** — waiting on flndrn bucket | Local dump + timer OK. Script ready. Need `BRIVEN_BACKUP_S3_*` in `/etc/briven/backup.env` (see `infra/backups/BACKUP-OFFSITE.md`). |
| **0.2** | Discord webhooks (alerts + deploys) | **Deferred — not a build gate** | Optional ops “pager” into chat — **not customer product**. flndrn 2026-07-20: drop from engineering gate. Alerts already wired if useful later. |
| **0.3** | Trademark filing EU + Benelux | **Deferred — not a build gate** | Legal track only. |
| **0.4** | Phase 0 sign-off (ADR + status closed) | **Not done** | After **0.1** green only. |

---

## Agent actions already taken (still not Phase Done)

| When | Action | Evidence |
| --- | --- | --- |
| 2026-07-19 | Fixed backup script for live compose postgres container | `/usr/local/bin/briven-backup.sh` dumps `briven_control` from `briven-brivenfrance-uilsk6-postgres-1` |
| 2026-07-19 | Reset failed timer; next fire scheduled | `systemctl list-timers`: **Mon 2026-07-20 02:17:00 CEST** |
| 2026-07-19 | Manual run succeeded **local only** | `ok briven_control: 742814 bytes → /var/backups/briven/briven_control/2026-07-19/11-05-35.dump.gz` + log: `off-site upload skipped` |
| 2026-07-19 | Installed `OnFailure=briven-backup-alert.service` unit files | Present on host; Discord still unproven without webhook |

**These repairs do not make 0.1 Done** — off-site mirror still missing.

---

## What only flndrn can provide

1. **0.1** — Create S3-compatible bucket; give agent (or paste into `/etc/briven/backup.env`) the four `BRIVEN_BACKUP_S3_*` values — see `infra/backups/BACKUP-OFFSITE.md`.

---

## When Phase 0 becomes Done (engineering)

**0.1** off-site upload succeeds once + journal shows `off-site upload ok`.  
Then agent writes 0.4 ADR and marks Phase 0 **Done**.

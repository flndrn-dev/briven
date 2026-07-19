# Off-site backup (Phase 0.1) — operator handoff

**You (flndrn)** create the S3-compatible bucket (Backblaze B2, Cloudflare R2, or AWS S3).  
**Agent** only needs the four values below written into `/etc/briven/backup.env` on France, then a test run.

## Values to put in `/etc/briven/backup.env`

```bash
# S3-compatible off-site (required for Phase 0.1 Done)
BRIVEN_BACKUP_S3_ENDPOINT=https://YOUR_ENDPOINT   # e.g. s3.eu-central-003.backblazeb2.com  or  <accountid>.r2.cloudflarestorage.com
BRIVEN_BACKUP_S3_BUCKET=your-bucket-name
BRIVEN_BACKUP_S3_ACCESS_KEY=…
BRIVEN_BACKUP_S3_SECRET_KEY=…
```

Notes:

- Endpoint is **host only** with `https://` (script strips scheme for `mc`).
- Bucket should be **private**, versioning optional, EU region preferred.
- Local dumps already land under `/var/backups/briven/` even if upload is skipped.

## After you add the keys

On France (agent can run once keys exist):

```bash
systemctl start briven-backup.service
journalctl -u briven-backup.service -n 40 --no-pager
# Expect: "off-site upload ok"  (not "skipped")
```

## Discord (Phase 0.2)

| Channel | Env var | Status (2026-07-19) |
| --- | --- | --- |
| Alerts | `BRIVEN_DISCORD_WEBHOOK_ALERTS` | **Live** — wired into `/etc/briven/backup.env` + smoke HTTP 204 |
| Deploys | `BRIVEN_DISCORD_WEBHOOK_DEPLOYS` | **Token invalid (401)** — recreate webhook in Discord → paste new URL into Dokploy env **and** `/etc/briven/backup.env` |

Backup failure alerts use the **alerts** webhook only (`OnFailure=briven-backup-alert.service`).

## Trademark

**Not a build gate.** Legal filing can proceed on its own schedule; it does not block Phase 0 close for engineering.

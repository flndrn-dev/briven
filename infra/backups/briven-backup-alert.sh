#!/usr/bin/env bash
# Posts a Discord alert when briven-backup.service exits non-zero. Invoked
# by systemd's OnFailure= hook on briven-backup.service; see
# road-to-ga.md §0.1 + §0.2 for the contract.
#
# Reads $BRIVEN_DISCORD_WEBHOOK_ALERTS from /etc/briven/backup.env (via
# EnvironmentFile= in the .service unit). Reads /run/briven-backup-status
# for the failure detail written by briven-backup.sh.
#
# Behaviour:
#   - webhook unset  → log "no webhook configured" and exit 0 (silent
#     skip; OnFailure already counted the parent unit as failed)
#   - webhook set    → POST a JSON payload with the failing DBs, exit 0
#     even on curl failure so systemd doesn't cascade alerts on the alert

set -uo pipefail

HOSTNAME_SHORT="$(hostname -s 2>/dev/null || echo unknown)"
STATUS_FILE="/run/briven-backup-status"

log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

if [ -z "${BRIVEN_DISCORD_WEBHOOK_ALERTS:-}" ]; then
  log "no BRIVEN_DISCORD_WEBHOOK_ALERTS configured — skipping Discord alert"
  exit 0
fi

upload_failures="unknown"
upload_failure_dbs="unknown"
if [ -r "$STATUS_FILE" ]; then
  # shellcheck disable=SC1090
  source "$STATUS_FILE"
fi

# Discord embed payload. Title makes it visually red, description names
# the failing DBs. We deliberately keep this short — no recipient PII
# (none of these are user-bound) but also no oversharing of bucket /
# credentials. The journalctl tail is the source of truth for ops; this
# message just routes attention.
PAYLOAD=$(cat <<JSON
{
  "username": "briven-backup",
  "embeds": [{
    "title": "briven backup: off-site upload failed",
    "color": 15158332,
    "description": "Host: \`${HOSTNAME_SHORT}\`\nFailed uploads: \`${upload_failures}\`\nDatabases: \`${upload_failure_dbs}\`\n\nLocal dumps are safe. Investigate with:\n\`\`\`\njournalctl -u briven-backup.service -n 200\n\`\`\`"
  }]
}
JSON
)

# curl: --silent --show-error to keep journal clean on success but
# capture errors. --fail to treat 4xx/5xx as failure. Timeout caps tail
# latency at 10s so OnFailure's cascade can't stall a reboot.
if ! curl --silent --show-error --fail \
      --max-time 10 \
      -H 'content-type: application/json' \
      -d "$PAYLOAD" \
      "$BRIVEN_DISCORD_WEBHOOK_ALERTS" >/dev/null; then
  log "Discord webhook POST failed — alert was not delivered"
fi

# Always exit 0 — the parent unit's failure status is what matters.
# A failure here just means the operator finds out via journal instead.
exit 0

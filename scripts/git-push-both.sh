#!/usr/bin/env bash
# DEPRECATED dual-push (GitHub + Konnos).
#
# flndrn 2026-07: production source of truth is Konnos only.
# GitHub dual-push was dropped — use:
#   ./scripts/git-push-konnos.sh
#
# This wrapper still works so old muscle memory does not push to GitHub.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "note: dual-push to GitHub is OFF. Pushing Konnos only…"
exec "$ROOT/scripts/git-push-konnos.sh" "$@"

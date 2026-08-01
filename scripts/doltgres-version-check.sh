#!/usr/bin/env bash
# Doltgres version tracker — compares our PINNED doltgresql image against the
# latest upstream release, so we "move along" when DoltHub ships fixes.
#
# WHY: Doltgres is Beta; releases carry lock/concurrency/panic fixes we depend on
# (see docs/knowledge-base.md → "INCIDENT 2026-08-01" — 0.56.6 locked under load,
# fixed by upgrading to 0.57.2). This is a MANUAL, on-demand check — NOT a
# Watchtower/host-side poller (forbidden by infra/CLAUDE.md). Run it locally or
# from the brain cron; it never runs on the deploy host and never auto-upgrades.
#
# Usage:  bash scripts/doltgres-version-check.sh
# Exit:   0 = up to date, 10 = newer release available, 1 = error.
#
# On a newer release: follow the tested upgrade procedure in
# docs/knowledge-base.md → "Doltgres version pinning + upgrade process".

set -euo pipefail

COMPOSE="${BRIVEN_COMPOSE_FILE:-$(cd "$(dirname "$0")/.." && pwd)/infra/dokploy/compose.dokploy.yml}"

# --- our pinned version (from the compose image tag) ---
PINNED="$(grep -oE 'dolthub/doltgresql:[0-9]+\.[0-9]+\.[0-9]+' "$COMPOSE" | head -1 | cut -d: -f2 || true)"
if [[ -z "$PINNED" ]]; then
  echo "!! could not read a pinned dolthub/doltgresql:<version> tag from $COMPOSE"
  echo "   (is it still pinned by @sha256 digest? switch to a version tag — see KB)"
  exit 1
fi

# --- latest upstream release tag ---
LATEST="$(curl -fsSL --max-time 20 https://api.github.com/repos/dolthub/doltgresql/releases/latest \
  | grep -oE '"tag_name"[[:space:]]*:[[:space:]]*"v?[0-9]+\.[0-9]+\.[0-9]+"' \
  | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
if [[ -z "$LATEST" ]]; then
  echo "!! could not fetch latest doltgresql release from GitHub"; exit 1
fi

echo "Doltgres pinned (ours): $PINNED"
echo "Doltgres latest (upstream): $LATEST"

# --- compare (sort -V) ---
if [[ "$PINNED" == "$LATEST" ]]; then
  echo "✓ up to date."
  exit 0
fi
newest="$(printf '%s\n%s\n' "$PINNED" "$LATEST" | sort -V | tail -1)"
if [[ "$newest" == "$PINNED" ]]; then
  echo "✓ our pin is ahead of/equal to latest release (pre-release?). No action."
  exit 0
fi

echo
echo "⚠ NEWER Doltgres available: $PINNED -> $LATEST"
echo "  Release notes: https://github.com/dolthub/doltgresql/releases/tag/v$LATEST"
echo "  Open issues:   https://github.com/dolthub/doltgresql/issues"
echo "  To upgrade: follow docs/knowledge-base.md → 'Doltgres version pinning + upgrade process'"
echo "  (validate data-read on a throwaway first; keep auto_gc_behavior.enable:false)"
exit 10

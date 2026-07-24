#!/usr/bin/env bash
# Push Briven main → Konnos ONLY (no GitHub).
#
# Dokploy auto-deploy for briven-france is wired to:
#   https://code.konnos.org/flndrn/Briven.git  (customGit)
# so production rebuilds from Konnos pushes, not GitHub.
#
# Usage:
#   ./scripts/git-push-konnos.sh setup   # configure remotes only
#   ./scripts/git-push-konnos.sh         # configure + push main
#   ./scripts/git-push-konnos.sh main    # configure + push that branch

set -euo pipefail

KONNOS_URL="${BRIVEN_KONNOS_URL:-https://code.konnos.org/flndrn/Briven.git}"
ARG="${1:-main}"

if [[ "$ARG" == "setup" ]]; then
  DO_PUSH=0
  BRANCH="main"
else
  DO_PUSH=1
  BRANCH="$ARG"
fi

# origin = Konnos only (fetch + push). No GitHub dual-push.
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$KONNOS_URL"
  # Drop any extra push URLs (old dual-push config)
  # re-set single push URL
  git remote set-url --push origin "$KONNOS_URL" 2>/dev/null || true
else
  git remote add origin "$KONNOS_URL"
fi

# Keep named konnos remote as alias
if git remote get-url konnos >/dev/null 2>&1; then
  git remote set-url konnos "$KONNOS_URL"
else
  git remote add konnos "$KONNOS_URL"
fi

# Remove accidental github-only remote if present as separate name
# (do not delete "github" if user has one; only clean dual-push on origin)

echo "origin fetch: $(git remote get-url origin)"
echo "origin push:  $(git remote get-url --push origin 2>/dev/null || git remote get-url origin)"
echo "konnos:       $(git remote get-url konnos)"

if [[ "$DO_PUSH" -eq 1 ]]; then
  echo "Pushing '${BRANCH}' → Konnos only (code.konnos.org)…"
  git push -u origin "$BRANCH"
  echo "Done. Konnos is source of truth. Dokploy should auto-deploy if webhook/autoDeploy is on."
fi

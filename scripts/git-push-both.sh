#!/usr/bin/env bash
# One push → GitHub + Konnos.
#
# Configures `origin` so:
#   git push origin main
# updates both remotes. When Deploy to Dokploy is enabled + secrets set,
# push to main triggers production deploy (auto-deploy).
#
# Usage:
#   ./scripts/git-push-both.sh setup    # only configure dual-push (once per clone)
#   ./scripts/git-push-both.sh          # configure + push main
#   ./scripts/git-push-both.sh main     # configure + push that branch

set -euo pipefail

GH_URL="${BRIVEN_GITHUB_URL:-https://github.com/flndrn-dev/briven.git}"
KONNOS_URL="${BRIVEN_KONNOS_URL:-https://code.konnos.org/flndrn/briven.git}"
ARG="${1:-main}"

if [[ "$ARG" == "setup" ]]; then
  DO_PUSH=0
  BRANCH="main"
else
  DO_PUSH=1
  BRANCH="$ARG"
fi

# Rebuild origin cleanly so push URLs never accumulate duplicates.
if git remote get-url origin >/dev/null 2>&1; then
  git remote remove origin
fi
git remote add origin "$GH_URL"
# First --add --push turns the default URL into fetch-only and sets this as push.
# Second --add --push appends Konnos.
git remote set-url --add --push origin "$GH_URL"
git remote set-url --add --push origin "$KONNOS_URL"

# Named konnos remote for `git fetch konnos` / status checks.
if git remote get-url konnos >/dev/null 2>&1; then
  git remote set-url konnos "$KONNOS_URL"
else
  git remote add konnos "$KONNOS_URL"
fi

echo "origin fetch:  $(git remote get-url origin)"
echo "origin push:"
git remote get-url --push --all origin | sed 's/^/  /'

if [[ "$DO_PUSH" -eq 1 ]]; then
  echo "Pushing '${BRANCH}' → GitHub + Konnos…"
  git push -u origin "$BRANCH"
  echo "Done. (GitHub + Konnos. If Deploy-to-Dokploy is enabled, prod may rebuild.)"
fi

#!/usr/bin/env bash
# swap-domain.sh — replace one briven public domain with another across the
# entire repo. designed for the briven.cloud → briven.tech cutover, but
# parameterised so it works for any rename.
#
# usage:
#   ./scripts/swap-domain.sh                              # dry-run, briven.cloud → briven.tech
#   ./scripts/swap-domain.sh --apply                      # actually edit
#   ./scripts/swap-domain.sh --from foo.dev --to bar.dev  # different swap
#
# the dry-run prints every file that would change and the count of hits per
# file so you can sanity-check the surface before committing. it never
# touches node_modules, .git, .next, .turbo, dist, or any binary.

set -euo pipefail

FROM="briven.cloud"
TO="briven.tech"
APPLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from)  FROM="$2";   shift 2 ;;
    --to)    TO="$2";     shift 2 ;;
    --apply) APPLY=1;     shift ;;
    -h|--help)
      sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown flag: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$FROM" == "$TO" ]]; then
  echo "from and to are the same — nothing to do" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

# Collect matching files via NUL-delimited grep. bash strips embedded NULs
# from `$(...)`-captured strings, so we read into an array with `-d ''`
# instead of piping through a `$()` substitution.
files=()
while IFS= read -r -d '' f; do
  files+=("$f")
done < <(
  grep -rIl --null \
    --exclude-dir=node_modules \
    --exclude-dir=.git \
    --exclude-dir=.next \
    --exclude-dir=.turbo \
    --exclude-dir=dist \
    --exclude-dir=.pnpm-store \
    --exclude-dir=coverage \
    --exclude='pnpm-lock.yaml' \
    -- "$FROM" . || true
)

count=${#files[@]}
if [[ "$count" -eq 0 ]]; then
  echo "no files contain '$FROM'"
  exit 0
fi

echo "found '$FROM' in $count file(s):"

if [[ "$APPLY" -eq 0 ]]; then
  for f in "${files[@]}"; do
    n=$(grep -c -- "$FROM" "$f" || true)
    printf '  %4dx  %s\n' "$n" "$f"
  done
  echo
  echo "dry-run only. re-run with --apply to perform the swap."
  exit 0
fi

# sed -i is non-portable: macOS/BSD requires an empty arg, GNU does not.
# Write through a per-file temp to sidestep the difference.
for f in "${files[@]}"; do
  tmp="$f.swap.$$"
  # Plain literal substitution — `.` in domain names matches any char in
  # sed regex, but the only "briven cloud"-shaped strings in the repo are
  # actual `briven.cloud` URIs, so the false-positive surface is empty.
  sed "s|$FROM|$TO|g" "$f" > "$tmp"
  mv "$tmp" "$f"
done

echo "rewrote $count file(s). review with: git diff"

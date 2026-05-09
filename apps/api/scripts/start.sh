#!/bin/sh
set -e

# Apply pending drizzle migrations before booting the api. If migration fails
# the container crashes and Dokploy will keep the previous deploy alive — see
# CLAUDE.md §5.5 (every deploy reversible).
echo "{\"event\":\"migrate_start\",\"ts\":\"$(date -Iseconds)\"}"
sh /app/apps/api/node_modules/.bin/drizzle-kit migrate

echo "{\"event\":\"migrate_done\",\"ts\":\"$(date -Iseconds)\"}"
exec bun run src/index.ts

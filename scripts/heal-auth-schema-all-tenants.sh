#!/usr/bin/env bash
# Heal Briven Auth schema drift on EVERY project database.
#
# Why: older "Enable Auth" tenants only got the first tables. Later columns
# (two_factor_enabled) and tables (_briven_auth_email_templates, passkeys, …)
# were missing → magic-link / email-OTP returned HTTP 500 (Mavi 2026-07-21).
#
# Safe to re-run. Skips DBs with no _briven_auth_users (auth never enabled).
# Doltgres: no ADD COLUMN IF NOT EXISTS — we probe then ALTER.
#
# Usage (on the host that runs doltgres, with PGPASSWORD or .pgpass):
#   ./scripts/heal-auth-schema-all-tenants.sh
# Or via docker:
#   DOLTGRES_CONTAINER=briven-…-doltgres-1 \
#   CONTROL_URL_FROM_API=1 \
#   ./scripts/heal-auth-schema-all-tenants.sh

set -euo pipefail

C="${DOLTGRES_CONTAINER:-briven-brivenfrance-uilsk6-doltgres-1}"
API_C="${API_CONTAINER:-briven-brivenfrance-uilsk6-api-1}"

if [[ -z "${PGPASSWORD:-}" ]]; then
  if docker inspect "$API_C" &>/dev/null; then
    URL=$(docker inspect "$API_C" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^BRIVEN_DATABASE_URL=//p' | head -1)
    PGPASSWORD=$(printf '%s' "$URL" | python3 -c 'import sys; from urllib.parse import urlparse,unquote; u=urlparse(sys.stdin.read().strip()); print(unquote(u.password or ""))')
    export PGPASSWORD
  fi
fi

psqlc() {
  local db="$1"; shift
  docker exec -e PGPASSWORD="$PGPASSWORD" "$C" \
    psql -h 127.0.0.1 -U postgres -d "$db" -v ON_ERROR_STOP=0 -t -A -c "$1" 2>&1
}

mapfile -t DBS < <(docker exec -e PGPASSWORD="$PGPASSWORD" "$C" \
  psql -h 127.0.0.1 -U postgres -d postgres -t -A \
  -c "SELECT datname FROM pg_database WHERE datname LIKE 'proj_%' ORDER BY 1;")

echo "healing ${#DBS[@]} project databases on $C …"
healed=0
skipped=0
partial=0

for DB in "${DBS[@]}"; do
  [[ -z "$DB" ]] && continue
  has_users=$(psqlc "$DB" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='_briven_auth_users';" | tr -d '[:space:]')
  if [[ "$has_users" != "1" ]]; then
    echo "  $DB  skip (no auth tables)"
    skipped=$((skipped + 1))
    continue
  fi

  has_col=$(psqlc "$DB" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='_briven_auth_users' AND column_name='two_factor_enabled';" | tr -d '[:space:]')
  if [[ "$has_col" != "1" ]]; then
    psqlc "$DB" 'ALTER TABLE "_briven_auth_users" ADD COLUMN two_factor_enabled boolean NOT NULL DEFAULT false;' >/dev/null || true
  fi

  for sql in \
    'CREATE TABLE IF NOT EXISTS "_briven_auth_jwks" (id text PRIMARY KEY, public_key text NOT NULL, private_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz);' \
    'CREATE TABLE IF NOT EXISTS "_briven_auth_email_templates" (id text PRIMARY KEY, name text NOT NULL, subject text NOT NULL, html text NOT NULL, text text, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());' \
    'CREATE UNIQUE INDEX IF NOT EXISTS "_briven_auth_email_templates_name_uniq" ON "_briven_auth_email_templates" (name);' \
    'CREATE TABLE IF NOT EXISTS "_briven_auth_two_factors" (id text PRIMARY KEY, secret text NOT NULL, backup_codes text NOT NULL, user_id text NOT NULL REFERENCES "_briven_auth_users"(id) ON DELETE CASCADE, verified boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());' \
    'CREATE INDEX IF NOT EXISTS "_briven_auth_two_factors_user_idx" ON "_briven_auth_two_factors" (user_id);' \
    'CREATE TABLE IF NOT EXISTS "_briven_auth_passkeys" (id text PRIMARY KEY, name text, public_key text NOT NULL, user_id text NOT NULL REFERENCES "_briven_auth_users"(id) ON DELETE CASCADE, credential_id text NOT NULL, counter bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());' \
    'CREATE INDEX IF NOT EXISTS "_briven_auth_passkeys_user_idx" ON "_briven_auth_passkeys" (user_id);'
  do
    psqlc "$DB" "$sql" >/dev/null || true
  done

  email_t=$(psqlc "$DB" "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='_briven_auth_email_templates';" | tr -d '[:space:]')
  t2fa=$(psqlc "$DB" "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='_briven_auth_users' AND column_name='two_factor_enabled';" | tr -d '[:space:]')
  if [[ "$email_t" == "1" && "$t2fa" == "1" ]]; then
    echo "  $DB  HEALED_OK"
    healed=$((healed + 1))
  else
    echo "  $DB  PARTIAL email_templates=$email_t two_factor_enabled=$t2fa"
    partial=$((partial + 1))
  fi
done

echo "done: healed_ok=$healed skipped=$skipped partial=$partial total=${#DBS[@]}"
[[ "$partial" -eq 0 ]]

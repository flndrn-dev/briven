#!/usr/bin/env bash
# S6 auth reliability verify — safe, read-only probes (no deploy, no Redis kill).
# Usage: ./scripts/s6-auth-verify.sh [api_origin]
set -euo pipefail

API="${1:-https://api.briven.tech}"

echo "== S6 auth reliability verify =="
echo "api: $API"
echo

echo "-- /health --"
curl -sS -m 8 "$API/health" | tee /tmp/s6-health.json
echo
echo

echo "-- /ready --"
READY_CODE=$(curl -sS -m 8 -o /tmp/s6-ready.json -w '%{http_code}' "$API/ready" || true)
cat /tmp/s6-ready.json
echo
echo "http: $READY_CODE"
echo

echo "-- /info --"
curl -sS -m 8 "$API/info" | tee /tmp/s6-info.json
echo
echo

python3 - <<'PY'
import json, sys
ready = json.load(open("/tmp/s6-ready.json"))
health = json.load(open("/tmp/s6-health.json"))
info = json.load(open("/tmp/s6-info.json"))
checks = ready.get("checks") or {}
ok = True
def need(cond, msg):
    global ok
    mark = "PASS" if cond else "FAIL"
    if not cond: ok = False
    print(f"  [{mark}] {msg}")

print("== verdict ==")
need(health.get("status") == "ok", "health status ok")
need(health.get("env") == "production" or health.get("env") == "development", f"env={health.get('env')}")
need(ready.get("status") == "ready", "ready status ready")
need(checks.get("redis") in ("ok", "not_configured"), f"redis={checks.get('redis')}")
need(checks.get("control_postgres") == "ok", f"control_postgres={checks.get('control_postgres')}")
need(bool(info.get("buildSha")), f"buildSha={str(info.get('buildSha'))[:12]}")
print()
if ok:
    print("S6 platform probes PASS.")
    print("Still required for full S6 product claim:")
    print("  - Human AUTH-GO-LIVE rows 1–4 + 7 on pilot project")
    print("  - Second-project isolation in dashboard (see docs/S6-RELIABILITY.md)")
    sys.exit(0)
print("S6 platform probes FAIL — fix /ready before pilot sign-off.")
sys.exit(1)
PY

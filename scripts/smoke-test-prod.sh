#!/bin/bash
# Production smoke test — run after every publish to verify core endpoints are healthy.
# Usage: ./scripts/smoke-test-prod.sh [base_url]
# Default base_url: https://playonfutsal.com

set -euo pipefail

BASE_URL="${1:-https://playonfutsal.com}"
PASS=0
FAIL=0
BODY_FILE="/tmp/smoke_body_$$"

cleanup() { rm -f "$BODY_FILE"; }
trap cleanup EXIT

# Fetch URL; sets LAST_HTTP_CODE and LAST_BODY globals
fetch() {
  local url="$1"
  LAST_HTTP_CODE=$(curl -s -o "$BODY_FILE" -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
  LAST_BODY=$(cat "$BODY_FILE")
}

pass() { echo "PASS [$1] HTTP $LAST_HTTP_CODE — $2"; PASS=$((PASS + 1)); }
fail() { echo "FAIL [$1] $2 — got: ${LAST_BODY:0:120}"; FAIL=$((FAIL + 1)); }

assert_json_object_field() {
  local label="$1" url="$2" field="$3"
  fetch "$url"
  if [[ "$LAST_HTTP_CODE" != 2* ]]; then fail "$label" "HTTP $LAST_HTTP_CODE"; return; fi
  if python3 -c "import sys,json; d=json.loads(open('$BODY_FILE').read()); assert '$field' in d" 2>/dev/null; then
    pass "$label" "field '$field' present"
  else
    fail "$label" "missing field '$field'"
  fi
}

assert_json_array() {
  local label="$1" url="$2"
  fetch "$url"
  if [[ "$LAST_HTTP_CODE" != 2* ]]; then fail "$label" "HTTP $LAST_HTTP_CODE"; return; fi
  if python3 -c "import sys,json; d=json.loads(open('$BODY_FILE').read()); assert isinstance(d,list)" 2>/dev/null; then
    pass "$label" "valid JSON array"
  else
    fail "$label" "not a JSON array"
  fi
}

assert_age_group_arrays() {
  local label="$1" url="$2"
  fetch "$url"
  if [[ "$LAST_HTTP_CODE" != 2* ]]; then fail "$label" "HTTP $LAST_HTTP_CODE"; return; fi
  local verdict
  verdict=$(python3 - "$BODY_FILE" <<'PYEOF'
import sys, json
with open(sys.argv[1]) as f:
    data = json.load(f)
if not isinstance(data, list):
    print("not_array")
    sys.exit(0)
for item in data:
    ag = item.get("ageGroup") or item.get("age_group")
    if ag is not None and not isinstance(ag, list):
        print(f"bad_age_group:{ag!r}")
        sys.exit(0)
print("ok")
PYEOF
  )
  if [[ "$verdict" == "ok" ]]; then
    pass "$label" "age_group values are arrays (migration 0037 confirmed)"
  else
    fail "$label" "age_group not an array: $verdict"
  fi
}

assert_frontend_loads() {
  local label="$1" url="$2"
  fetch "$url"
  if [[ "$LAST_HTTP_CODE" != 2* ]]; then fail "$label" "HTTP $LAST_HTTP_CODE"; return; fi
  if echo "$LAST_BODY" | grep -qi "<html"; then
    pass "$label" "HTML returned"
  else
    fail "$label" "response does not look like HTML"
  fi
}

echo "=== PlayOn production smoke test: $BASE_URL ==="
echo ""

# API health — must return {"status":"ok"}
assert_json_object_field "API health"              "$BASE_URL/api/healthz"            "status"

# Core listing endpoints — age_group must be arrays (confirms migration 0037 in prod)
assert_age_group_arrays  "Leagues age_group"       "$BASE_URL/api/leagues"
assert_age_group_arrays  "Tournaments age_group"   "$BASE_URL/api/tournaments"
assert_age_group_arrays  "Camps age_group"         "$BASE_URL/api/camps"

# Programs featured — must not crash (previously 500 before fix)
assert_json_array        "Programs featured"       "$BASE_URL/api/programs/featured"

# Drop-ins — must return valid JSON array
assert_json_array        "Drop-ins list"           "$BASE_URL/api/dropins"

# Frontend — must return HTML
assert_frontend_loads    "Frontend root"           "$BASE_URL/"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
if [[ "$FAIL" -gt 0 ]]; then exit 1; fi

#!/bin/bash
# Database integration test script for SimHammer
# Usage: ./test-db.sh [BASE_URL]
# Default: http://localhost:8000

BASE=${1:-http://localhost:8000}
PASS=0
FAIL=0

check() {
  local desc="$1"
  local expected="$2"
  local actual="$3"
  if echo "$actual" | grep -qF "$expected"; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "    expected to contain: $expected"
    echo "    got: $actual"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== SimHammer DB Test Suite ==="
echo "Target: $BASE"
echo ""

# ── 1. Health ────────────────────────────────────────
echo "--- Health ---"
RESP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health")
check "GET /health returns 200" "200" "$RESP"

# ── 2. Characters CRUD ──────────────────────────────
echo ""
echo "--- Characters ---"

# Create
CHAR=$(curl -s -X POST "$BASE/api/characters" \
  -H "Content-Type: application/json" \
  -d '{"simc_input": "warrior=\"TestWarrior\"\nserver=TestRealm\nspec=arms\ntalents=AAA"}')
check "POST /api/characters returns name" "TestWarrior" "$CHAR"
check "POST /api/characters returns realm" "TestRealm" "$CHAR"
CHAR_ID=$(echo "$CHAR" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

# List
LIST=$(curl -s "$BASE/api/characters")
check "GET /api/characters contains character" "$CHAR_ID" "$LIST"

# Talent builds
BUILDS=$(curl -s "$BASE/api/characters/$CHAR_ID/talents")
check "GET talents returns array" "[" "$BUILDS"
BUILD_ID=$(echo "$BUILDS" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

# Delete talent build
if [ -n "$BUILD_ID" ]; then
  DEL_BUILD=$(curl -s -X DELETE "$BASE/api/talent-builds/$BUILD_ID")
  check "DELETE talent build" "ok" "$DEL_BUILD"
fi

# Upsert same character (should update, not duplicate)
CHAR2=$(curl -s -X POST "$BASE/api/characters" \
  -H "Content-Type: application/json" \
  -d '{"simc_input": "warrior=\"TestWarrior\"\nserver=TestRealm\nspec=fury\ntalents=BBB"}')
CHAR2_ID=$(echo "$CHAR2" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
check "Upsert returns same id" "$CHAR_ID" "$CHAR2_ID"
check "Upsert updated spec" "fury" "$CHAR2"

# Count after upsert should still be 1
LIST2=$(curl -s "$BASE/api/characters")
COUNT=$(echo "$LIST2" | grep -o '"id"' | wc -l)
check "No duplicate after upsert (count=1)" "1" "$COUNT"

# Delete character
DEL=$(curl -s -X DELETE "$BASE/api/characters/$CHAR_ID")
check "DELETE /api/characters/{id}" "ok" "$DEL"

# List should be empty
EMPTY=$(curl -s "$BASE/api/characters")
check "Characters empty after delete" "[]" "$EMPTY"

# ── 3. Routes CRUD ───────────────────────────────────
echo ""
echo "--- Routes ---"

# Create
ROUTE=$(curl -s -X POST "$BASE/api/routes" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Route", "mdt_string": "!test_mdt_string"}')
check "POST /api/routes returns name" "Test Route" "$ROUTE"
ROUTE_ID=$(echo "$ROUTE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

# List
RLIST=$(curl -s "$BASE/api/routes")
check "GET /api/routes contains route" "$ROUTE_ID" "$RLIST"

# Delete
RDEL=$(curl -s -X DELETE "$BASE/api/routes/$ROUTE_ID")
check "DELETE /api/routes/{id}" "ok" "$RDEL"

# Empty
REMPTY=$(curl -s "$BASE/api/routes")
check "Routes empty after delete" "[]" "$REMPTY"

# ── 4. Admin settings ───────────────────────────────
echo ""
echo "--- Admin Settings ---"

TOKEN_RESP=$(curl -s -X POST "$BASE/api/admin/login" \
  -H "Content-Type: application/json" \
  -d '{"password": "test123"}')

if echo "$TOKEN_RESP" | grep -q "token"; then
  TOKEN=$(echo "$TOKEN_RESP" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

  # Get settings
  SETTINGS=$(curl -s "$BASE/api/admin/settings" -H "Authorization: Bearer $TOKEN")
  check "GET /api/admin/settings returns settings" "max_combinations" "$SETTINGS"

  # Update settings
  UPD=$(curl -s -X PUT "$BASE/api/admin/settings" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"max_combinations": 7, "max_scenarios": 5}')
  check "PUT /api/admin/settings updates" "max_combinations" "$UPD"

  # Verify update
  SETTINGS2=$(curl -s "$BASE/api/admin/settings" -H "Authorization: Bearer $TOKEN")
  check "Settings reflect update (max_combinations=7)" '"max_combinations":7' "$SETTINGS2"
  check "Settings reflect update (max_scenarios=5)" '"max_scenarios":5' "$SETTINGS2"
else
  echo "  SKIP: Admin endpoints (ADMIN_PASSWORD not set or login failed)"
  echo "    Response: $TOKEN_RESP"
fi

# ── 5. Jobs ──────────────────────────────────────────
echo ""
echo "--- Jobs ---"

# Create a job (will fail without simc binary, but DB write should succeed)
JOB=$(curl -s -X POST "$BASE/api/sim" \
  -H "Content-Type: application/json" \
  -d '{
    "simc_input": "warrior=\"JobTest\"\nserver=JobRealm\nspec=arms",
    "sim_type": "quick_sim",
    "raw": true,
    "max_upgrade": false,
    "options": {
      "iterations": 100,
      "fight_style": "Patchwerk",
      "target_error": 0.5,
      "talents": "",
      "spec_override": "",
      "batch_id": null,
      "simc_branch": "",
      "simc_header": "",
      "simc_base_player": "",
      "custom_apl": "",
      "simc_raid_actors": "",
      "simc_post_combos": "",
      "simc_footer": ""
    }
  }')
check "POST /api/sim returns id" '"id"' "$JOB"
JOB_ID=$(echo "$JOB" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$JOB_ID" ]; then
  # Small delay for the spawned task to update status
  sleep 1

  # Get job status
  STATUS=$(curl -s "$BASE/api/sim/$JOB_ID")
  check "GET /api/sim/{id} returns job" "$JOB_ID" "$STATUS"

  # Get job input
  INPUT=$(curl -s "$BASE/api/sim/$JOB_ID/input")
  check "GET /api/sim/{id}/input returns input" "JobTest" "$INPUT"
fi

# ── 6. Concurrency ───────────────────────────────────
echo ""
echo "--- Concurrency ---"

# Fire 5 character creates in parallel
for i in $(seq 1 5); do
  curl -s -X POST "$BASE/api/characters" \
    -H "Content-Type: application/json" \
    -d "{\"simc_input\": \"warrior=\\\"ConcTest$i\\\"\\nserver=Realm$i\\nspec=arms\"}" > /dev/null &
done
wait
sleep 1

CLIST=$(curl -s "$BASE/api/characters")
CCOUNT=$(echo "$CLIST" | grep -o '"id"' | wc -l)
check "5 concurrent creates produced 5 characters" "5" "$CCOUNT"

# Clean up
for id in $(echo "$CLIST" | grep -o '"id":"[^"]*"' | cut -d'"' -f4); do
  curl -s -X DELETE "$BASE/api/characters/$id" > /dev/null
done

# ── Summary ──────────────────────────────────────────
echo ""
echo "================================"
echo "PASS: $PASS   FAIL: $FAIL"
if [ $FAIL -eq 0 ]; then
  echo "All tests passed!"
else
  echo "Some tests failed."
  exit 1
fi

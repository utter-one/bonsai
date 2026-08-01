#!/usr/bin/env bash
# Self-contained CLI integration test.
# Creates a test project, populates all entity types, exercises CRUD, tears down.
#
# Prerequisites:
#   - Server running on http://localhost:3000
#   - ~/.bonsairc with valid auth token (or set BONSAI_API_TOKEN)
#   - At least one LLM provider exists (used for classifier/stage/transformer)
#
# Usage:
#   cd cli && bash test/integration.sh

set -euo pipefail

BASE="http://localhost:3000"
CLI="node bin/bonsai"
PASS=0
FAIL=0
TOTAL=0

# ─── Helpers ───────────────────────────────────────────────────────────────────

run() {
  TOTAL=$((TOTAL + 1))
  local desc="$1"; shift
  local expected_exit="${1:-0}"; shift
  local output exit_code

  output=$(eval "$@" 2>&1) && exit_code=0 || exit_code=$?

  if [ "$exit_code" -eq "$expected_exit" ]; then
    PASS=$((PASS + 1))
    echo "  ✓ $desc"
  else
    FAIL=$((FAIL + 1))
    echo "  ✗ $desc (expected exit $expected_exit, got $exit_code)"
    echo "    output: $(echo "$output" | head -1 | tr '\n' ' ')"
  fi
}

# Extract a JSON field value from CLI output.
json_field() {
  grep "\"$1\"" | head -1 | cut -d'"' -f4
}

# Extract version for optimistic locking.
json_version() {
  grep "\"version\"" | head -1 | sed 's/.*: *\([0-9]*\).*/\1/' || echo "0"
}

# ─── Phase 0: Bootstrap ───────────────────────────────────────────────────────

echo ""
echo "=== Phase 0: Bootstrap ==="

# Find an existing LLM provider for classifier/stage/transformer.
LLM_PROVIDER_ID=$($CLI providers list --base-url "$BASE" --json \
  | grep -B10 '"llm"' | grep '"id"' | head -1 | cut -d'"' -f4)

if [ -z "$LLM_PROVIDER_ID" ]; then
  echo "  ✗ No LLM provider found. Create one first."
  exit 1
fi
echo "  ✓ LLM provider: $LLM_PROVIDER_ID"

# ─── Phase 1: Create Test Project ─────────────────────────────────────────────

echo ""
echo "=== Phase 1: Create Test Project ==="

PROJECT_OUTPUT=$($CLI projects create --base-url "$BASE" --json \
  --data '{"name":"CLI Test Project","acceptVoice":false,"generateVoice":false}')
PROJECT_ID=$(echo "$PROJECT_OUTPUT" | json_field "id")
PROJECT_VERSION=$(echo "$PROJECT_OUTPUT" | json_version)

if [ -z "$PROJECT_ID" ]; then
  echo "  ✗ Failed to create test project"
  echo "$PROJECT_OUTPUT"
  exit 1
fi
echo "  ✓ Project: $PROJECT_ID (v$PROJECT_VERSION)"

# ─── Phase 2: Create Tier 0 Entities (no cross-entity deps) ───────────────────

echo ""
echo "=== Phase 2: Tier 0 — Provider, Guardrail, Global Action, User, API Key, Category, Decorator, Tester, Tool ==="

# Provider (localStorage — no external deps)
PROV_OUTPUT=$($CLI providers create --base-url "$BASE" --json \
  --data '{"name":"CLI Test Storage","providerType":"storage","apiType":"local","config":{"basePath":"/tmp/bonsai-cli-test"}}')
PROVIDER_ID=$(echo "$PROV_OUTPUT" | json_field "id")
PROVIDER_VERSION=$(echo "$PROV_OUTPUT" | json_version)
echo "  ✓ Provider: $PROVIDER_ID (v$PROVIDER_VERSION)"

# Agent (needs projectId, no required foreign keys)
AGENT_OUTPUT=$($CLI agents create --base-url "$BASE" --project "$PROJECT_ID" --json \
  --data '{"name":"CLI Test Agent","prompt":"You are a test agent.","ttsSettings":{"provider":"openai"}}')
AGENT_ID=$(echo "$AGENT_OUTPUT" | json_field "id")
AGENT_VERSION=$(echo "$AGENT_OUTPUT" | json_version)
echo "  ✓ Agent: $AGENT_ID (v$AGENT_VERSION)"

# Classifier (needs projectId, llmProviderId)
CLASS_OUTPUT=$($CLI classifiers create --base-url "$BASE" --project "$PROJECT_ID" --json \
  --data "{\"name\":\"CLI Test Classifier\",\"prompt\":\"Classify input.\",\"llmProviderId\":\"$LLM_PROVIDER_ID\",\"llmSettings\":{\"model\":\"gpt-4o-mini\"}}")
CLASS_ID=$(echo "$CLASS_OUTPUT" | json_field "id")
CLASS_VERSION=$(echo "$CLASS_OUTPUT" | json_version)
echo "  ✓ Classifier: $CLASS_ID (v$CLASS_VERSION)"

# Context Transformer (needs projectId, llmProviderId)
CTX_OUTPUT=$($CLI context_transformers create --base-url "$BASE" --project "$PROJECT_ID" --json \
  --data "{\"name\":\"CLI Test Transformer\",\"prompt\":\"Transform context.\",\"llmProviderId\":\"$LLM_PROVIDER_ID\",\"llmSettings\":{\"model\":\"gpt-4o-mini\"}}")
CTX_ID=$(echo "$CTX_OUTPUT" | json_field "id")
CTX_VERSION=$(echo "$CTX_OUTPUT" | json_version)
echo "  ✓ Context Transformer: $CTX_ID (v$CTX_VERSION)"

# Tool — script variant (no provider needed)
TOOL_OUTPUT=$($CLI tools create --base-url "$BASE" --project "$PROJECT_ID" --json \
  --data '{"name":"CLI Test Tool","type":"script","code":"return 42;"}')
TOOL_ID=$(echo "$TOOL_OUTPUT" | json_field "id")
TOOL_VERSION=$(echo "$TOOL_OUTPUT" | json_version)
echo "  ✓ Tool: $TOOL_ID (v$TOOL_VERSION)"

# Guardrail
GR_OUTPUT=$($CLI guardrails create --base-url "$BASE" --project "$PROJECT_ID" --json \
  --data '{"name":"CLI Test Guardrail"}')
GR_ID=$(echo "$GR_OUTPUT" | json_field "id")
GR_VERSION=$(echo "$GR_OUTPUT" | json_version)
echo "  ✓ Guardrail: $GR_ID (v$GR_VERSION)"

# Global Action
GA_OUTPUT=$($CLI global_actions create --base-url "$BASE" --project "$PROJECT_ID" --json \
  --data '{"name":"CLI Test Action"}')
GA_ID=$(echo "$GA_OUTPUT" | json_field "id")
GA_VERSION=$(echo "$GA_OUTPUT" | json_version)
echo "  ✓ Global Action: $GA_ID (v$GA_VERSION)"

# Knowledge Category
KC_OUTPUT=$($CLI knowledge_categories create --base-url "$BASE" --project "$PROJECT_ID" --json \
  --data '{"name":"CLI Test Category","promptTrigger":"faq"}')
KC_ID=$(echo "$KC_OUTPUT" | json_field "id")
KC_VERSION=$(echo "$KC_OUTPUT" | json_version)
echo "  ✓ Knowledge Category: $KC_ID (v$KC_VERSION)"

# User
USER_OUTPUT=$($CLI users create --base-url "$BASE" --project "$PROJECT_ID" --json \
  --data '{"profile":{}}')
USER_ID=$(echo "$USER_OUTPUT" | json_field "id")
echo "  ✓ User: $USER_ID"

# API Key
KEY_OUTPUT=$($CLI api_keys create --base-url "$BASE" --project "$PROJECT_ID" --json \
  --data '{"name":"CLI Test Key","expiresIn":3600,"metadata":{}}')
KEY_ID=$(echo "$KEY_OUTPUT" | json_field "id")
KEY_VERSION=$(echo "$KEY_OUTPUT" | json_version)
echo "  ✓ API Key: $KEY_ID (v$KEY_VERSION)"

# Copy Decorator
CD_OUTPUT=$($CLI copy_decorators create --base-url "$BASE" --project "$PROJECT_ID" --json \
  --data '{"name":"CLI Test Decorator","template":"[{{content}}]"}')
CD_ID=$(echo "$CD_OUTPUT" | json_field "id")
CD_VERSION=$(echo "$CD_OUTPUT" | json_version)
echo "  ✓ Copy Decorator: $CD_ID (v$CD_VERSION)"

# Tester
TESTER_OUTPUT=$($CLI testers create --base-url "$BASE" --project "$PROJECT_ID" --json \
  --data '{"name":"CLI Test Tester","prompt":"You are a test user."}')
TESTER_ID=$(echo "$TESTER_OUTPUT" | json_field "id")
TESTER_VERSION=$(echo "$TESTER_OUTPUT" | json_version)
echo "  ✓ Tester: $TESTER_ID (v$TESTER_VERSION)"

# Sample Copy
SC_OUTPUT=$($CLI sample_copies create --base-url "$BASE" --project "$PROJECT_ID" --json \
  --data '{"name":"CLI Test Copy","promptTrigger":"greeting","content":["Hello!"]}')
SC_ID=$(echo "$SC_OUTPUT" | json_field "id")
SC_VERSION=$(echo "$SC_OUTPUT" | json_version)
echo "  ✓ Sample Copy: $SC_ID (v$SC_VERSION)"

# ─── Phase 3: Create Tier 1 Entities (depend on Tier 0) ──────────────────────

echo ""
echo "=== Phase 3: Tier 1 — Knowledge Item, Stage, Scenario ==="

# Knowledge Item (needs categoryId)
KI_OUTPUT=$($CLI knowledge_items create --base-url "$BASE" --project "$PROJECT_ID" --json \
  --data "{\"categoryId\":\"$KC_ID\",\"questions\":[\"What is this?\"],\"answer\":\"A test item.\"}")
KI_ID=$(echo "$KI_OUTPUT" | json_field "id")
KI_VERSION=$(echo "$KI_OUTPUT" | json_version)
echo "  ✓ Knowledge Item: $KI_ID (v$KI_VERSION)"

# Stage (needs projectId, agentId, llmProviderId)
STAGE_OUTPUT=$($CLI stages create --base-url "$BASE" --project "$PROJECT_ID" --json \
  --data "{\"name\":\"CLI Test Stage\",\"prompt\":\"You are in a test stage.\",\"llmProviderId\":\"$LLM_PROVIDER_ID\",\"llmSettings\":{\"model\":\"gpt-4o-mini\"},\"agentId\":\"$AGENT_ID\"}")
STAGE_ID=$(echo "$STAGE_OUTPUT" | json_field "id")
STAGE_VERSION=$(echo "$STAGE_OUTPUT" | json_version)
echo "  ✓ Stage: $STAGE_ID (v$STAGE_VERSION)"

# Scenario (needs projectId, startingStageId)
SCENARIO_OUTPUT=$($CLI scenarios create --base-url "$BASE" --project "$PROJECT_ID" --json \
  --data "{\"name\":\"CLI Test Scenario\",\"language\":\"en-US\",\"startingStageId\":\"$STAGE_ID\",\"maxTurns\":10}")
SCENARIO_ID=$(echo "$SCENARIO_OUTPUT" | json_field "id")
SCENARIO_VERSION=$(echo "$SCENARIO_OUTPUT" | json_version)
echo "  ✓ Scenario: $SCENARIO_ID (v$SCENARIO_VERSION)"

# ─── Phase 4: CRUD Tests ─────────────────────────────────────────────────────

echo ""
echo "=== Phase 4: CRUD Operations ==="

# -- Agent: get, update, audit --
echo ""
echo "--- Agent ---"
run "Agent get" 0 "$CLI agents get --base-url $BASE --project $PROJECT_ID $AGENT_ID --json"
run "Agent update" 0 "$CLI agents update --base-url $BASE --project $PROJECT_ID $AGENT_ID --json --data \"{\\\"name\\\":\\\"CLI Test Agent Updated\\\",\\\"version\\\":$AGENT_VERSION}\""
run "Agent audit" 0 "$CLI agents audit --base-url $BASE --project $PROJECT_ID $AGENT_ID --json"

# -- Classifier: get, update --
echo ""
echo "--- Classifier ---"
run "Classifier get" 0 "$CLI classifiers get --base-url $BASE --project $PROJECT_ID $CLASS_ID --json"
run "Classifier update" 0 "$CLI classifiers update --base-url $BASE --project $PROJECT_ID $CLASS_ID --json --data \"{\\\"name\\\":\\\"Updated Classifier\\\",\\\"version\\\":$CLASS_VERSION}\""

# -- Tool: get, update --
echo ""
echo "--- Tool ---"
run "Tool get" 0 "$CLI tools get --base-url $BASE --project $PROJECT_ID $TOOL_ID --json"
run "Tool update" 0 "$CLI tools update --base-url $BASE --project $PROJECT_ID $TOOL_ID --json --data \"{\\\"name\\\":\\\"Updated Tool\\\",\\\"type\\\":\\\"script\\\",\\\"code\\\":\\\"return 43;\\\",\\\"version\\\":$TOOL_VERSION}\""

# -- Guardrail: get, update --
echo ""
echo "--- Guardrail ---"
run "Guardrail get" 0 "$CLI guardrails get --base-url $BASE --project $PROJECT_ID $GR_ID --json"
run "Guardrail update" 0 "$CLI guardrails update --base-url $BASE --project $PROJECT_ID $GR_ID --json --data \"{\\\"name\\\":\\\"Updated Guardrail\\\",\\\"version\\\":$GR_VERSION}\""

# -- Knowledge Category: get, update, items_list --
echo ""
echo "--- Knowledge Category ---"
run "Knowledge category get" 0 "$CLI knowledge_categories get --base-url $BASE --project $PROJECT_ID $KC_ID --json"
run "Knowledge category items_list" 0 "$CLI knowledge_categories items_list --base-url $BASE --project $PROJECT_ID $KC_ID --json"
run "Knowledge category update" 0 "$CLI knowledge_categories update --base-url $BASE --project $PROJECT_ID $KC_ID --json --data \"{\\\"name\\\":\\\"Updated Category\\\",\\\"version\\\":$KC_VERSION}\""

# -- Knowledge Item: get, update --
echo ""
echo "--- Knowledge Item ---"
run "Knowledge item get" 0 "$CLI knowledge_items get --base-url $BASE --project $PROJECT_ID $KI_ID --json"
run "Knowledge item update" 0 "$CLI knowledge_items update --base-url $BASE --project $PROJECT_ID $KI_ID --json --data \"{\\\"answer\\\":\\\"Updated answer.\\\",\\\"version\\\":$KI_VERSION}\""

# -- Stage: get, update --
echo ""
echo "--- Stage ---"
run "Stage get" 0 "$CLI stages get --base-url $BASE --project $PROJECT_ID $STAGE_ID --json"
run "Stage update" 0 "$CLI stages update --base-url $BASE --project $PROJECT_ID $STAGE_ID --json --data \"{\\\"name\\\":\\\"Updated Stage\\\",\\\"version\\\":$STAGE_VERSION}\""

# -- Scenario: get, update --
echo ""
echo "--- Scenario ---"
run "Scenario get" 0 "$CLI scenarios get --base-url $BASE --project $PROJECT_ID $SCENARIO_ID --json"
run "Scenario update" 0 "$CLI scenarios update --base-url $BASE --project $PROJECT_ID $SCENARIO_ID --json --data \"{\\\"name\\\":\\\"Updated Scenario\\\",\\\"version\\\":$SCENARIO_VERSION}\""

# -- API Key: get, update, delete --
echo ""
echo "--- API Key ---"
run "API key get" 0 "$CLI api_keys get --base-url $BASE --project $PROJECT_ID $KEY_ID --json"
run "API key update" 0 "$CLI api_keys update --base-url $BASE --project $PROJECT_ID $KEY_ID --json --data \"{\\\"name\\\":\\\"Updated Key\\\",\\\"version\\\":$KEY_VERSION}\""
KEY_VERSION=2
run "API key delete" 0 "$CLI api_keys delete --base-url $BASE --project $PROJECT_ID $KEY_ID --json --data \"{\\\"version\\\":$KEY_VERSION}\""

# -- User: get, update --
echo ""
echo "--- User ---"
run "User get" 0 "$CLI users get --base-url $BASE --project $PROJECT_ID $USER_ID --json"
run "User update" 0 "$CLI users update --base-url $BASE --project $PROJECT_ID $USER_ID --json --data '{\"profile\":{\"name\":\"test\"}}'"

# -- Tester: get, update --
echo ""
echo "--- Tester ---"
run "Tester get" 0 "$CLI testers get --base-url $BASE --project $PROJECT_ID $TESTER_ID --json"
run "Tester update" 0 "$CLI testers update --base-url $BASE --project $PROJECT_ID $TESTER_ID --json --data \"{\\\"name\\\":\\\"Updated Tester\\\",\\\"version\\\":$TESTER_VERSION}\""

# -- Context Transformer: get, update --
echo ""
echo "--- Context Transformer ---"
run "Context transformer get" 0 "$CLI context_transformers get --base-url $BASE --project $PROJECT_ID $CTX_ID --json"
run "Context transformer update" 0 "$CLI context_transformers update --base-url $BASE --project $PROJECT_ID $CTX_ID --json --data \"{\\\"name\\\":\\\"Updated Transformer\\\",\\\"version\\\":$CTX_VERSION}\""

# -- Global Action: get, update --
echo ""
echo "--- Global Action ---"
run "Global action get" 0 "$CLI global_actions get --base-url $BASE --project $PROJECT_ID $GA_ID --json"
run "Global action update" 0 "$CLI global_actions update --base-url $BASE --project $PROJECT_ID $GA_ID --json --data \"{\\\"name\\\":\\\"Updated Action\\\",\\\"version\\\":$GA_VERSION}\""

# -- Copy Decorator: get, update --
echo ""
echo "--- Copy Decorator ---"
run "Copy decorator get" 0 "$CLI copy_decorators get --base-url $BASE --project $PROJECT_ID $CD_ID --json"
run "Copy decorator update" 0 "$CLI copy_decorators update --base-url $BASE --project $PROJECT_ID $CD_ID --json --data \"{\\\"name\\\":\\\"Updated Decorator\\\",\\\"version\\\":$CD_VERSION}\""

# -- Sample Copy: get, update --
echo ""
echo "--- Sample Copy ---"
run "Sample copy get" 0 "$CLI sample_copies get --base-url $BASE --project $PROJECT_ID $SC_ID --json"
run "Sample copy update" 0 "$CLI sample_copies update --base-url $BASE --project $PROJECT_ID $SC_ID --json --data \"{\\\"name\\\":\\\"Updated Copy\\\",\\\"version\\\":$SC_VERSION}\""

# -- Provider: get, update --
echo ""
echo "--- Provider ---"
run "Provider get" 0 "$CLI providers get --base-url $BASE $PROVIDER_ID --json"
run "Provider update" 0 "$CLI providers update --base-url $BASE $PROVIDER_ID --json --data \"{\\\"name\\\":\\\"Updated Provider\\\",\\\"version\\\":$PROVIDER_VERSION}\""

# -- Project: get, update --
echo ""
echo "--- Project ---"
run "Project get" 0 "$CLI projects get --base-url $BASE $PROJECT_ID --json"
PROJECT_VERSION=$(echo "$PROJECT_OUTPUT" | json_version)
run "Project update" 0 "$CLI projects update --base-url $BASE $PROJECT_ID --json --data \"{\\\"name\\\":\\\"CLI Test Project Updated\\\",\\\"version\\\":$PROJECT_VERSION}\""

# ─── Phase 5: Feature Tests ──────────────────────────────────────────────────

echo ""
echo "=== Phase 5: Features ==="

# -- List with query params --
echo ""
echo "--- Query Params ---"
run "List with offset/limit" 0 "$CLI agents list --base-url $BASE --project $PROJECT_ID --offset 0 --limit 1 --json"
run "List with textSearch" 0 "$CLI agents list --base-url $BASE --project $PROJECT_ID --textSearch 'CLI Test' --json"

# -- JSON Schema --
echo ""
echo "--- JSON Schema ---"
run "JSON schema output" 0 "$CLI agents list --base-url $BASE --json-schema"

# -- Verbose --
echo ""
echo "--- Verbose ---"
run "Verbose output" 0 "$CLI projects list --base-url $BASE --verbose"

# -- Pagination --
echo ""
echo "--- Pagination ---"
run "Paginate flag" 0 "$CLI projects list --base-url $BASE --paginate --json"

# -- Clone --
echo ""
echo "--- Clone ---"
run "Agent clone" 0 "$CLI agents clone --base-url $BASE --project $PROJECT_ID $AGENT_ID --json --data \"{\\\"name\\\":\\\"Cloned Agent\\\"}\""

# -- Profile --
echo ""
echo "--- Profile ---"
run "Profile get" 0 "$CLI profile get --base-url $BASE --json"

# -- Analytics --
echo ""
echo "--- Analytics ---"
run "Analytics usage" 0 "$CLI analytics_usage list --base-url $BASE --project $PROJECT_ID --json"

# ─── Phase 6: Error Cases ────────────────────────────────────────────────────

echo ""
echo "=== Phase 6: Error Cases ==="

run "Invalid token → exit 3" 3 "$CLI projects list --base-url $BASE --token invalid_token --json"
run "Missing project → exit 2" 2 "$CLI agents list --base-url $BASE --json"
run "Network error → exit 8" 8 "$CLI projects list --base-url http://localhost:9999 --json"
run "Missing path param → exit 1" 1 "$CLI agents get --base-url $BASE --project $PROJECT_ID --json"
run "Invalid JSON body → exit 1" 1 "$CLI agents create --base-url $BASE --project $PROJECT_ID --data '{bad}' --json"
run "404 nonexistent entity → exit 4" 4 "$CLI agents get --base-url $BASE --project $PROJECT_ID agnt_nonexistent --json"

# ─── Phase 7: Teardown ───────────────────────────────────────────────────────

echo ""
echo "=== Phase 7: Teardown ==="

# Re-fetch versions for entities that were updated (version bumped).
get_version() {
  local resource="$1" id="$2"
  local output
  if [ "$resource" = "providers" ]; then
    output=$($CLI "$resource" get --base-url "$BASE" "$id" --json 2>/dev/null)
  else
    output=$($CLI "$resource" get --base-url "$BASE" --project "$PROJECT_ID" "$id" --json 2>/dev/null)
  fi
  echo "$output" | json_version
}

# Delete in reverse dependency order.
delete_entity() {
  local resource="$1" id="$2" scope="$3"
  local version
  version=$(get_version "$resource" "$id")
  local result
  if [ "$scope" = "global" ]; then
    result=$($CLI "$resource" delete --base-url "$BASE" "$id" --data "{\"version\":$version}" --json 2>&1)
  else
    result=$($CLI "$resource" delete --base-url "$BASE" --project "$PROJECT_ID" "$id" --data "{\"version\":$version}" --json 2>&1)
  fi
  if echo "$result" | grep -q '"ok"'; then
    echo "  ✓ Deleted $resource: $id"
  else
    # Some deletes return "OK" text, not JSON
    if echo "$result" | grep -qi 'ok'; then
      echo "  ✓ Deleted $resource: $id"
    else
      echo "  ✗ Failed to delete $resource: $id"
      echo "    $result"
    fi
  fi
}

# Tier 3+ first
delete_entity "scenarios" "$SCENARIO_ID" "project"

# Tier 1
delete_entity "knowledge_items" "$KI_ID" "project"
delete_entity "stages" "$STAGE_ID" "project"

# Tier 0 (reverse creation order)
delete_entity "sample_copies" "$SC_ID" "project"
delete_entity "copy_decorators" "$CD_ID" "project"
delete_entity "testers" "$TESTER_ID" "project"
delete_entity "global_actions" "$GA_ID" "project"
delete_entity "context_transformers" "$CTX_ID" "project"
delete_entity "guardrails" "$GR_ID" "project"
delete_entity "tools" "$TOOL_ID" "project"
delete_entity "knowledge_categories" "$KC_ID" "project"
delete_entity "classifiers" "$CLASS_ID" "project"
delete_entity "agents" "$AGENT_ID" "project"

# Global provider
delete_entity "providers" "$PROVIDER_ID" "global"

# Users can't be deleted via CLI (no delete action), skip.

# Archive and delete project
echo ""
echo "--- Project Cleanup ---"
PROJECT_VERSION=$(get_version "projects" "$PROJECT_ID" || echo "1")
echo "  Project version: $PROJECT_VERSION"
$CLI projects archive --base-url "$BASE" "$PROJECT_ID" --data "{\"version\":$PROJECT_VERSION}" --json >/dev/null 2>&1 || true
echo "  Project archived"
$CLI projects delete --base-url "$BASE" "$PROJECT_ID" --data "{\"version\":$PROJECT_VERSION}" --json >/dev/null 2>&1 || true
echo "  ✓ Project archived and deleted"

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Total: $TOTAL  |  Pass: $PASS  |  Fail: $FAIL"
echo "═══════════════════════════════════════════════════════════"

[ "$FAIL" -eq 0 ] && echo "  All tests passed." || echo "  Some tests failed."
exit "$FAIL"

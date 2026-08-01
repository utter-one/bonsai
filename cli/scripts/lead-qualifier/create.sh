#!/usr/bin/env bash
# Creates the full "Lead Qualifier" project from JSON payloads.
#
# Usage:
#   cd cli && bash scripts/lead-qualifier/create.sh
#
# Prerequisites:
#   - Server running on http://localhost:3000
#   - ~/.bonsairc with valid auth token (or set BONSAI_API_TOKEN)
#   - jq installed
#   - Existing providers (override IDs via env vars below)

set -euo pipefail

BASE="http://localhost:3000"
CLI="node bin/bonsai"
DATA_DIR="$(cd "$(dirname "$0")" && pwd)/data"

# ─── Provider IDs (override via env) ──────────────────────────────────────────
ASR_PROVIDER="${BONSAI_ASR_PROVIDER:-prov_019de8b3-95e5-770b-b300-de56597c414a}"
STORAGE_PROVIDER="${BONSAI_STORAGE_PROVIDER:-prov_019e5f75-acff-7498-8712-9831eab59859}"
LLM_PROVIDER="${BONSAI_LLM_PROVIDER:-prov_019db17a-3e2a-773e-98ea-cc37cf661084}"
TTS_PROVIDER="${BONSAI_TTS_PROVIDER:-prov_019ed070-4ade-70c9-b301-b82a8c3b0a89}"

# ─── Helpers ──────────────────────────────────────────────────────────────────

# Create an entity, print status, return ID via global variable RESULT_ID
create_entity() {
  local label="$1" resource="$2" json_file="$3"
  local payload output id

  payload=$(sub_placeholders "$json_file" | jq -c '.')
  output=$($CLI "$resource" create --base-url "$BASE" --project "$PROJECT_ID" --json --data "$payload" 2>&1) || true
  id=$(echo "$output" | grep '"id"' | head -1 | cut -d'"' -f4)

  if [ -z "$id" ]; then
    echo "  ✗ $label"
    echo "$output" | head -3
    return 1
  fi
  echo "  ✓ $label: $id"
  RESULT_ID="$id"
}

# Create entity with raw JSON (no placeholder substitution) — for stage-referencing tools
create_entity_raw() {
  local label="$1" resource="$2" json_file="$3"
  local payload output id

  payload=$(jq -c '.' "$json_file")
  output=$($CLI "$resource" create --base-url "$BASE" --project "$PROJECT_ID" --json --data "$payload" 2>&1) || true
  id=$(echo "$output" | grep '"id"' | head -1 | cut -d'"' -f4)

  if [ -z "$id" ]; then
    echo "  ✗ $label"
    echo "$output" | head -3
    return 1
  fi
  echo "  ✓ $label: $id"
  RESULT_ID="$id"
}

# Create a global entity (no project scope)
create_global() {
  local label="$1" resource="$2" json_file="$3"
  local payload output id

  payload=$(sub_placeholders "$json_file" | jq -c '.')
  output=$($CLI "$resource" create --base-url "$BASE" --json --data "$payload" 2>&1) || true
  id=$(echo "$output" | grep '"id"' | head -1 | cut -d'"' -f4)

  if [ -z "$id" ]; then
    echo "  ✗ $label"
    echo "$output" | head -3
    return 1
  fi
  echo "  ✓ $label: $id"
  RESULT_ID="$id"
}

sub_placeholders() {
  # Build sed command dynamically — only substitute non-empty variables
  local sed_args=()
  for pair in \
    "__ASR_PROVIDER__:$ASR_PROVIDER" \
    "__STORAGE_PROVIDER__:$STORAGE_PROVIDER" \
    "__LLM_PROVIDER__:$LLM_PROVIDER" \
    "__TTS_PROVIDER__:$TTS_PROVIDER" \
    "__AGENT_ID__:$AGENT_ID" \
    "__CLASS_SKILLS_ID__:$CLASS_SKILLS_ID" \
    "__CLASS_INTENTS_ID__:$CLASS_INTENTS_ID" \
    "__CLASS_GUARDRAILS_ID__:$CLASS_GUARDRAILS_ID" \
    "__CTX_DATA_ID__:$CTX_DATA_ID" \
    "__CTX_DIRECTOR_ID__:$CTX_DIRECTOR_ID" \
    "__CTX_DIRECTOR2_ID__:$CTX_DIRECTOR2_ID" \
    "__TOOL_CRM_ADD_ID__:$TOOL_CRM_ADD_ID" \
    "__TOOL_CRM_EMAIL_ID__:$TOOL_CRM_EMAIL_ID" \
    "__TOOL_SUMMARY_GEN_ID__:$TOOL_SUMMARY_GEN_ID" \
    "__TOOL_SUMMARY_WEBHOOK_ID__:$TOOL_SUMMARY_WEBHOOK_ID" \
    "__TOOL_SMS_CHECK_ID__:$TOOL_SMS_CHECK_ID" \
    "__TOOL_PREFILL_MAIL_ID__:$TOOL_PREFILL_MAIL_ID" \
    "__TOOL_CHANNEL_CHECK_ID__:$TOOL_CHANNEL_CHECK_ID" \
    "__TOOL_SMS_ON_ENTER_ID__:$TOOL_SMS_ON_ENTER_ID" \
    "__TOOL_RESET_CONVO_ID__:$TOOL_RESET_CONVO_ID" \
    "__TOOL_END_DISQUALIFIED_ID__:$TOOL_END_DISQUALIFIED_ID" \
    "__TOOL_CHECK_CALENDAR_ID__:$TOOL_CHECK_CALENDAR_ID" \
    "__TOOL_SCHEDULE_CALL_ID__:$TOOL_SCHEDULE_CALL_ID" \
    "__STAGE_QUAL_ID__:$STAGE_QUAL_ID" \
    "__STAGE_BOOK_ID__:$STAGE_BOOK_ID" \
    "__STAGE_SMS_ID__:$STAGE_SMS_ID" \
    "__GACT_END_ID__:$GACT_END_ID" \
  ; do
    local placeholder="${pair%%:*}"
    local value="${pair#*:}"
    if [ -n "$value" ]; then
      sed_args+=(-e "s|${placeholder}|${value}|g")
    fi
  done
  sed "${sed_args[@]}" "$1"
}

# ─── Phase 1: Project ────────────────────────────────────────────────────────

echo ""
echo "=== Phase 1: Project ==="

create_global "Project" "projects" "$DATA_DIR/project.json"
PROJECT_ID="$RESULT_ID"

# ─── Phase 2: Agent ──────────────────────────────────────────────────────────

echo ""
echo "=== Phase 2: Agent ==="

create_entity "Agent" "agents" "$DATA_DIR/agent.json"
AGENT_ID="$RESULT_ID"

# ─── Phase 3: Classifiers ────────────────────────────────────────────────────

echo ""
echo "=== Phase 3: Classifiers ==="

create_entity "Classifier (Skills)" "classifiers" "$DATA_DIR/classifier_skills.json"
CLASS_SKILLS_ID="$RESULT_ID"

create_entity "Classifier (Intents&Events)" "classifiers" "$DATA_DIR/classifier_intents.json"
CLASS_INTENTS_ID="$RESULT_ID"

create_entity "Classifier (Guardrails)" "classifiers" "$DATA_DIR/classifier_guardrails.json"
CLASS_GUARDRAILS_ID="$RESULT_ID"

# ─── Phase 4: Context Transformers ───────────────────────────────────────────

echo ""
echo "=== Phase 4: Context Transformers ==="

create_entity "CT (Data Gathering)" "context_transformers" "$DATA_DIR/ctx_data_gathering.json"
CTX_DATA_ID="$RESULT_ID"

create_entity "CT (Director Whisper)" "context_transformers" "$DATA_DIR/ctx_director_whisper.json"
CTX_DIRECTOR_ID="$RESULT_ID"

create_entity "CT (Director Whisper2)" "context_transformers" "$DATA_DIR/ctx_director_whisper2.json"
CTX_DIRECTOR2_ID="$RESULT_ID"

# EVAL transformers (no cross-entity references)
for f in "$DATA_DIR"/ctx_eval_*.json; do
  [ -f "$f" ] || continue
  LABEL=$(basename "$f" .json | sed 's/ctx_eval_//')
  create_entity "CT (EVAL: $LABEL)" "context_transformers" "$f" > /dev/null
done

# Test evaluator
if [ -f "$DATA_DIR/ctx_test_evaluator_happy_path.json" ]; then
  create_entity "CT (Test Evaluator)" "context_transformers" "$DATA_DIR/ctx_test_evaluator_happy_path.json" > /dev/null
fi

# ─── Phase 5: Tools (without stage references first) ─────────────────────────

echo ""
echo "=== Phase 5: Tools ==="

# Tools without cross-entity references
create_entity "Tool (Add Contact to CRM)" "tools" "$DATA_DIR/tool_add_contact_crm.json"
TOOL_CRM_ADD_ID="$RESULT_ID"

create_entity "Tool (Update CRM Email)" "tools" "$DATA_DIR/tool_update_crm_email.json"
TOOL_CRM_EMAIL_ID="$RESULT_ID"

create_entity "Tool (Generate Summary)" "tools" "$DATA_DIR/tool_generate_summary.json"
TOOL_SUMMARY_GEN_ID="$RESULT_ID"

create_entity "Tool (Send Summary Webhook)" "tools" "$DATA_DIR/tool_send_summary.json"
TOOL_SUMMARY_WEBHOOK_ID="$RESULT_ID"

create_entity "Tool (Pre-fill Mail)" "tools" "$DATA_DIR/tool_prefill_mail.json"
TOOL_PREFILL_MAIL_ID="$RESULT_ID"

create_entity "Tool (Reset Conversation)" "tools" "$DATA_DIR/tool_reset_conversation.json"
TOOL_RESET_CONVO_ID="$RESULT_ID"

create_entity "Tool (End If Disqualified)" "tools" "$DATA_DIR/tool_end_if_disqualified.json"
TOOL_END_DISQUALIFIED_ID="$RESULT_ID"

create_entity "Tool (check_calendar)" "tools" "$DATA_DIR/tool_check_calendar.json"
TOOL_CHECK_CALENDAR_ID="$RESULT_ID"

create_entity "Tool (schedule_call)" "tools" "$DATA_DIR/tool_schedule_call.json"
TOOL_SCHEDULE_CALL_ID="$RESULT_ID"

# Tools with stage references — create raw (no stage substitution), update later
create_entity_raw "Tool (SMS Check Redirect)" "tools" "$DATA_DIR/tool_sms_check_redirect.json"
TOOL_SMS_CHECK_ID="$RESULT_ID"

create_entity_raw "Tool (Channel Check)" "tools" "$DATA_DIR/tool_channel_check.json"
TOOL_CHANNEL_CHECK_ID="$RESULT_ID"

create_entity_raw "Tool (SMS On Enter)" "tools" "$DATA_DIR/tool_sms_on_enter.json"
TOOL_SMS_ON_ENTER_ID="$RESULT_ID"

# ─── Phase 6: Guardrails ────────────────────────────────────────────────────

echo ""
echo "=== Phase 6: Guardrails ==="

for f in "$DATA_DIR"/gr_*.json; do
  [ -f "$f" ] || continue
  LABEL=$(basename "$f" .json | sed 's/gr_//')
  create_entity "Guardrail ($LABEL)" "guardrails" "$f" > /dev/null
done

# ─── Phase 7: Global Actions ─────────────────────────────────────────────────

echo ""
echo "=== Phase 7: Global Actions ==="

create_entity "Global Action (force_end)" "global_actions" "$DATA_DIR/gact_019d0104-6fa7-704d-b02d-b4a01b1134c0.json"
GACT_END_ID="$RESULT_ID"

create_entity "Global Action (SMS Redirect)" "global_actions" "$DATA_DIR/gact_019e2b4d-72af-717c-a386-9ae611293c1a.json"
GACT_SMS_ID="$RESULT_ID"

# ─── Phase 8: Stages ────────────────────────────────────────────────────────

echo ""
echo "=== Phase 8: Stages ==="

create_entity "Stage (Qualification)" "stages" "$DATA_DIR/stage_lead_qualifier_v2.json"
STAGE_QUAL_ID="$RESULT_ID"

create_entity "Stage (Book Call)" "stages" "$DATA_DIR/stage_book_call.json"
STAGE_BOOK_ID="$RESULT_ID"

create_entity "Stage (SMS Mail)" "stages" "$DATA_DIR/stage_sms_mail.json"
STAGE_SMS_ID="$RESULT_ID"

# ─── Phase 9: Back-fill Cross-References ─────────────────────────────────────

echo ""
echo "=== Phase 9: Back-fill Cross-References ==="

# Helper: update an entity by replacing a placeholder in its JSON
update_entity() {
  local resource="$1" entity_id="$2" old_val="$3" new_val="$4" label="$5"
  local current version new_data

  current=$($CLI "$resource" get --base-url "$BASE" --project "$PROJECT_ID" "$entity_id" --json 2>/dev/null)
  version=$(echo "$current" | jq -r '.version')
  new_data=$(echo "$current" | sed "s|$old_val|$new_val|g" | jq -c ". + {version: $version}")

  $CLI "$resource" update --base-url "$BASE" --project "$PROJECT_ID" "$entity_id" --json \
    --data "$new_data" > /dev/null 2>&1
  echo "  ✓ $label"
}

# Stage cross-references
update_entity "stages" "$STAGE_QUAL_ID" "__STAGE_BOOK_ID__" "$STAGE_BOOK_ID" "Qualification → Book Call"
update_entity "stages" "$STAGE_SMS_ID" "__STAGE_QUAL_ID__" "$STAGE_QUAL_ID" "SMS Mail → Qualification"

# Tool cross-references (stage IDs in code)
update_entity "tools" "$TOOL_SMS_CHECK_ID" "__STAGE_SMS_ID__" "$STAGE_SMS_ID" "SMS Check → SMS stage"
update_entity "tools" "$TOOL_CHANNEL_CHECK_ID" "__STAGE_SMS_ID__" "$STAGE_SMS_ID" "Channel Check → SMS stage"
update_entity "tools" "$TOOL_SMS_ON_ENTER_ID" "__STAGE_SMS_ID__" "$STAGE_SMS_ID" "SMS On Enter → SMS stage"

# ─── Phase 10: Finalize Project ──────────────────────────────────────────────

echo ""
echo "=== Phase 10: Finalize Project ==="

PROJECT_VERSION=$($CLI projects get --base-url "$BASE" "$PROJECT_ID" --json 2>/dev/null | jq -r '.version')

$CLI projects update --base-url "$BASE" "$PROJECT_ID" --json \
  --data "$(jq -nc \
    --arg s "$STAGE_QUAL_ID" \
    --arg g "$CLASS_GUARDRAILS_ID" \
    --argjson v "$PROJECT_VERSION" \
    '{startingStageId: $s, defaultGuardrailClassifierId: $g, version: $v}')" \
  > /dev/null 2>&1
echo "  ✓ Project finalized (startingStageId + defaultGuardrailClassifierId)"

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Lead Qualifier project: $PROJECT_ID"
echo "  Agent: $AGENT_ID"
echo "  Stages: $STAGE_QUAL_ID, $STAGE_BOOK_ID, $STAGE_SMS_ID"
echo "═══════════════════════════════════════════════════════════"

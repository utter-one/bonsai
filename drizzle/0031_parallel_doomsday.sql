CREATE INDEX "idx_conversation_events_project_type_timestamp" ON "conversation_events" USING btree ("project_id","event_type","timestamp");

-- Partial index covering analytics queries that filter assistant message events by project.
-- Covers: latency stats, percentiles, trend queries.
CREATE INDEX "idx_ce_assistant_messages"
  ON "conversation_events" ("project_id", "timestamp")
  WHERE event_type = 'message' AND event_data->>'role' = 'assistant';

-- Partial index covering the lateral join that finds the matching user message for a turn.
-- Covers: user-side metrics lookup (processingDurationMs, actionsDurationMs, asrDurationMs).
CREATE INDEX "idx_ce_user_messages"
  ON "conversation_events" ("project_id", "conversation_id", (event_data->'metadata'->>'turnIndex'))
  WHERE event_type = 'message' AND event_data->>'role' = 'user';
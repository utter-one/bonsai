-- Backfill project_id in audit_logs from old_entity or new_entity JSONB fields
UPDATE audit_logs
SET project_id = COALESCE(old_entity->>'projectId', new_entity->>'projectId')
WHERE project_id IS NULL
  AND COALESCE(old_entity->>'projectId', new_entity->>'projectId') IS NOT NULL;

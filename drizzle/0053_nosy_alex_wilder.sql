ALTER TABLE "conversation_artifacts" DROP CONSTRAINT "conversation_artifacts_project_id_event_id_conversation_events_project_id_id_fk";
--> statement-breakpoint
ALTER TABLE "testers" ADD COLUMN "hang_up_prompt" text;
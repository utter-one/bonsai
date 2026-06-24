ALTER TABLE "scenario_conversations" ADD COLUMN "test_run_status" text;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD COLUMN "error_count" integer DEFAULT 0 NOT NULL;
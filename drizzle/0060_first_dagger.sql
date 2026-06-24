ALTER TABLE "scenario_conversations" ADD COLUMN "test_statistics" jsonb;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD COLUMN "test_statistics" jsonb;
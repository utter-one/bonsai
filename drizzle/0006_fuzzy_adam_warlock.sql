ALTER TABLE "conversation_assets" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_assets" ADD COLUMN "artifact_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_assets" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "conversation_assets" ADD COLUMN "input_turn_id" text;--> statement-breakpoint
ALTER TABLE "conversation_assets" ADD COLUMN "output_turn_id" text;--> statement-breakpoint
ALTER TABLE "conversation_assets" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "conversation_assets" ADD COLUMN "storage_url" text;--> statement-breakpoint
ALTER TABLE "conversation_assets" ADD CONSTRAINT "conversation_assets_event_id_conversation_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."conversation_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_assets" RENAME TO "conversation_artifacts";
CREATE TABLE "deferred_processing" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"project_id" text NOT NULL,
	"conversation_id" text,
	"channel_type" text NOT NULL,
	"process_at" timestamp NOT NULL,
	"message" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "deferred_processing" ADD CONSTRAINT "deferred_processing_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deferred_processing" ADD CONSTRAINT "deferred_processing_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_deferred_processing_process_at_status" ON "deferred_processing" USING btree ("process_at","status");--> statement-breakpoint
CREATE INDEX "idx_deferred_processing_session_id" ON "deferred_processing" USING btree ("session_id");

CREATE TABLE "pending_tool_replies" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"tool_id" text NOT NULL,
	"request_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reply_data" jsonb,
	"reply_effects" jsonb,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "async_reply" jsonb DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "pending_tool_replies" ADD CONSTRAINT "pending_tool_replies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pending_tool_replies_request_id" ON "pending_tool_replies" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_pending_tool_replies_project_conversation" ON "pending_tool_replies" USING btree ("project_id","conversation_id");--> statement-breakpoint
CREATE INDEX "idx_pending_tool_replies_status_expires" ON "pending_tool_replies" USING btree ("status","expires_at");--> statement-breakpoint
UPDATE conversation_events
SET event_data = jsonb_set(
    event_data,
    '{status}',
    CASE
        WHEN event_data->>'success' = 'false' THEN '"failed"'::jsonb
        ELSE '"completed"'::jsonb
    END
)
WHERE event_type = 'tool_call'
  AND event_data ? 'success';
--> statement-breakpoint
UPDATE conversation_events
SET event_data = event_data - 'success'
WHERE event_type = 'tool_call'
  AND NOT (event_data ? 'success');

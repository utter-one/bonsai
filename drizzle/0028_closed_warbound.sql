CREATE TABLE "guardrails" (
	"id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"condition" text,
	"classification_trigger" text,
	"effects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"examples" jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "guardrails_project_id_id_pk" PRIMARY KEY("project_id","id")
);
--> statement-breakpoint
DROP VIEW "public"."active_projects";--> statement-breakpoint
DROP VIEW "public"."archived_projects";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "default_guardrail_classifier_id" text;--> statement-breakpoint
ALTER TABLE "guardrails" ADD CONSTRAINT "guardrails_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE VIEW "public"."active_projects" AS (select "id", "name", "description", "asr_config", "accept_voice", "generate_voice", "storage_config", "moderation_config", "constants", "metadata", "timezone", "auto_create_users", "user_profile_variable_descriptors", "default_guardrail_classifier_id", "version", "created_at", "updated_at", "archived_at", "archived_by" from "projects" where "projects"."archived_at" is null);--> statement-breakpoint
CREATE VIEW "public"."archived_projects" AS (select "id", "name", "description", "asr_config", "accept_voice", "generate_voice", "storage_config", "moderation_config", "constants", "metadata", "timezone", "auto_create_users", "user_profile_variable_descriptors", "default_guardrail_classifier_id", "version", "created_at", "updated_at", "archived_at", "archived_by" from "projects" where "projects"."archived_at" is not null);
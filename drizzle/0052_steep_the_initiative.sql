CREATE TABLE "scenario_conversations" (
	"id" text NOT NULL,
	"project_id" text NOT NULL,
	"scenario_run_id" text NOT NULL,
	"scenario_id" text NOT NULL,
	"tester_id" text NOT NULL,
	"conversation_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"data_extraction_results" jsonb,
	"data_transformation_results" jsonb,
	"metadata" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scenario_conversations_project_id_id_pk" PRIMARY KEY("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "scenario_runs" (
	"id" text NOT NULL,
	"project_id" text NOT NULL,
	"scenario_id" text NOT NULL,
	"tester_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_conversations" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"metadata" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scenario_runs_project_id_id_pk" PRIMARY KEY("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"language" text NOT NULL,
	"starting_stage_id" text NOT NULL,
	"max_turns" integer NOT NULL,
	"ending_stage_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"persona_can_hang_up" boolean DEFAULT false NOT NULL,
	"data_extraction" jsonb,
	"context_transformer_id" text,
	"data_post_processing_expected" jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scenarios_project_id_id_pk" PRIMARY KEY("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "testers" (
	"id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"prompt" text NOT NULL,
	"llm_provider_id" text,
	"llm_settings" jsonb,
	"user_profile" jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "testers_project_id_id_pk" PRIMARY KEY("project_id","id")
);
--> statement-breakpoint
ALTER TABLE "scenario_conversations" ADD CONSTRAINT "scenario_conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "testers" ADD CONSTRAINT "testers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_scenario_conversations_project_run" ON "scenario_conversations" USING btree ("project_id","scenario_run_id");--> statement-breakpoint
CREATE INDEX "idx_scenario_runs_project_scenario" ON "scenario_runs" USING btree ("project_id","scenario_id");
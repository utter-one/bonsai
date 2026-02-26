CREATE TABLE "stage_tools" (
	"id" text NOT NULL,
	"project_id" text NOT NULL,
	"flow_id" text NOT NULL,
	"stage_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"prompt" text NOT NULL,
	"llm_provider_id" text,
	"llm_settings" jsonb,
	"input_type" text NOT NULL,
	"output_type" text NOT NULL,
	"parameters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stage_tools_id_project_id_flow_id_stage_id_pk" PRIMARY KEY("id","project_id","flow_id","stage_id")
);
--> statement-breakpoint
ALTER TABLE "stage_tools" ADD CONSTRAINT "stage_tools_project_id_flow_id_flows_project_id_id_fk" FOREIGN KEY ("project_id","flow_id") REFERENCES "public"."flows"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_tools" ADD CONSTRAINT "stage_tools_project_id_stage_id_stages_project_id_id_fk" FOREIGN KEY ("project_id","stage_id") REFERENCES "public"."stages"("project_id","id") ON DELETE cascade ON UPDATE no action;
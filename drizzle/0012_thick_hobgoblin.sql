CREATE TABLE "flow_actions" (
	"id" text NOT NULL,
	"project_id" text NOT NULL,
	"flow_id" text NOT NULL,
	"name" text NOT NULL,
	"condition" text,
	"trigger_on_user_input" boolean DEFAULT true NOT NULL,
	"trigger_on_client_command" boolean DEFAULT false NOT NULL,
	"classification_trigger" text,
	"override_classifier_id" text,
	"parameters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"effects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"examples" jsonb,
	"metadata" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "flow_actions_project_id_id_pk" PRIMARY KEY("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "flow_tools" (
	"id" text NOT NULL,
	"project_id" text NOT NULL,
	"flow_id" text NOT NULL,
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
	CONSTRAINT "flow_tools_project_id_id_pk" PRIMARY KEY("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "flows" (
	"id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"metadata" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "flows_project_id_id_pk" PRIMARY KEY("project_id","id")
);
--> statement-breakpoint
ALTER TABLE "flow_actions" ADD CONSTRAINT "flow_actions_project_id_flow_id_flows_project_id_id_fk" FOREIGN KEY ("project_id","flow_id") REFERENCES "public"."flows"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_tools" ADD CONSTRAINT "flow_tools_project_id_flow_id_flows_project_id_id_fk" FOREIGN KEY ("project_id","flow_id") REFERENCES "public"."flows"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
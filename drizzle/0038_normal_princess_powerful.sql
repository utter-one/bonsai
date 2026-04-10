CREATE TABLE "sample_copies" (
	"id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"stages" jsonb,
	"agents" jsonb,
	"prompt_trigger" text NOT NULL,
	"classifier_override_id" text,
	"content" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"amount" integer DEFAULT 1 NOT NULL,
	"sampling_method" text DEFAULT 'random' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sample_copies_project_id_id_pk" PRIMARY KEY("project_id","id")
);
--> statement-breakpoint
ALTER TABLE "sample_copies" ADD CONSTRAINT "sample_copies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
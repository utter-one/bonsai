CREATE TABLE "copy_decorators" (
	"id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"template" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "copy_decorators_project_id_id_pk" PRIMARY KEY("project_id","id")
);
--> statement-breakpoint
ALTER TABLE "sample_copies" ADD COLUMN "decorator_id" text;--> statement-breakpoint
ALTER TABLE "copy_decorators" ADD CONSTRAINT "copy_decorators_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_copies" ADD CONSTRAINT "sample_copies_project_id_decorator_id_copy_decorators_project_id_id_fk" FOREIGN KEY ("project_id","decorator_id") REFERENCES "public"."copy_decorators"("project_id","id") ON DELETE no action ON UPDATE no action;
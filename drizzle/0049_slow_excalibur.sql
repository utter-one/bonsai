CREATE TABLE "saved_funnel_queries" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"project_id" text NOT NULL,
	"operator_id" text,
	"query" jsonb NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_funnel_queries" ADD CONSTRAINT "saved_funnel_queries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_funnel_queries" ADD CONSTRAINT "saved_funnel_queries_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_funnel_queries_project_id_name_unique" ON "saved_funnel_queries" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "idx_saved_funnel_queries_project_id" ON "saved_funnel_queries" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_saved_funnel_queries_operator_id" ON "saved_funnel_queries" USING btree ("operator_id");
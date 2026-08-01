CREATE TABLE "quick_prompts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"category_id" text NOT NULL,
	"owner_id" text,
	"name" text NOT NULL,
	"description" text,
	"content" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quick_prompts" ADD CONSTRAINT "quick_prompts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_prompts" ADD CONSTRAINT "quick_prompts_owner_id_operators_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_quick_prompts_project_id" ON "quick_prompts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_quick_prompts_category_id" ON "quick_prompts" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_quick_prompts_owner_id" ON "quick_prompts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_quick_prompts_is_public" ON "quick_prompts" USING btree ("is_public");
-- Step 1: Drop all FK constraints that reference old single-column PKs
ALTER TABLE "conversation_artifacts" DROP CONSTRAINT "conversation_artifacts_conversation_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_artifacts" DROP CONSTRAINT "conversation_artifacts_event_id_conversation_events_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_events" DROP CONSTRAINT "conversation_events_conversation_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_items" DROP CONSTRAINT "knowledge_items_category_id_knowledge_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "stages" DROP CONSTRAINT "stages_persona_id_personas_id_fk";
--> statement-breakpoint
ALTER TABLE "stages" DROP CONSTRAINT "stages_default_classifier_id_classifiers_id_fk";
--> statement-breakpoint

-- Step 2: Add project_id columns as NULLABLE to tables that need them
ALTER TABLE "knowledge_items" ADD COLUMN "project_id" text;
--> statement-breakpoint
ALTER TABLE "conversation_events" ADD COLUMN "project_id" text;
--> statement-breakpoint
ALTER TABLE "conversation_artifacts" ADD COLUMN "project_id" text;
--> statement-breakpoint

-- Step 3: Populate project_id from parent tables
UPDATE "knowledge_items" SET "project_id" = kc."project_id"
  FROM "knowledge_categories" kc
  WHERE "knowledge_items"."category_id" = kc."id";
--> statement-breakpoint
UPDATE "conversation_events" SET "project_id" = c."project_id"
  FROM "conversations" c
  WHERE "conversation_events"."conversation_id" = c."id";
--> statement-breakpoint
UPDATE "conversation_artifacts" SET "project_id" = c."project_id"
  FROM "conversations" c
  WHERE "conversation_artifacts"."conversation_id" = c."id";
--> statement-breakpoint

-- Step 4: Set project_id to NOT NULL after population
ALTER TABLE "knowledge_items" ALTER COLUMN "project_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversation_events" ALTER COLUMN "project_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversation_artifacts" ALTER COLUMN "project_id" SET NOT NULL;
--> statement-breakpoint

-- Step 5: Drop old single-column primary keys
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_pkey";
--> statement-breakpoint
ALTER TABLE "classifiers" DROP CONSTRAINT "classifiers_pkey";
--> statement-breakpoint
ALTER TABLE "context_transformers" DROP CONSTRAINT "context_transformers_pkey";
--> statement-breakpoint
ALTER TABLE "conversation_artifacts" DROP CONSTRAINT "conversation_artifacts_pkey";
--> statement-breakpoint
ALTER TABLE "conversation_events" DROP CONSTRAINT "conversation_events_pkey";
--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_pkey";
--> statement-breakpoint
ALTER TABLE "global_actions" DROP CONSTRAINT "global_actions_pkey";
--> statement-breakpoint
ALTER TABLE "issues" DROP CONSTRAINT "issues_pkey";
--> statement-breakpoint
ALTER TABLE "knowledge_categories" DROP CONSTRAINT "knowledge_categories_pkey";
--> statement-breakpoint
ALTER TABLE "knowledge_items" DROP CONSTRAINT "knowledge_items_pkey";
--> statement-breakpoint
ALTER TABLE "personas" DROP CONSTRAINT "personas_pkey";
--> statement-breakpoint
ALTER TABLE "stages" DROP CONSTRAINT "stages_pkey";
--> statement-breakpoint
ALTER TABLE "tools" DROP CONSTRAINT "tools_pkey";
--> statement-breakpoint

-- Step 6: Create new composite primary keys
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_id_pk" PRIMARY KEY("project_id","id");
--> statement-breakpoint
ALTER TABLE "classifiers" ADD CONSTRAINT "classifiers_project_id_id_pk" PRIMARY KEY("project_id","id");
--> statement-breakpoint
ALTER TABLE "context_transformers" ADD CONSTRAINT "context_transformers_project_id_id_pk" PRIMARY KEY("project_id","id");
--> statement-breakpoint
ALTER TABLE "conversation_artifacts" ADD CONSTRAINT "conversation_artifacts_project_id_id_pk" PRIMARY KEY("project_id","id");
--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_project_id_id_pk" PRIMARY KEY("project_id","id");
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_id_pk" PRIMARY KEY("project_id","id");
--> statement-breakpoint
ALTER TABLE "global_actions" ADD CONSTRAINT "global_actions_project_id_id_pk" PRIMARY KEY("project_id","id");
--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_id_pk" PRIMARY KEY("project_id","id");
--> statement-breakpoint
ALTER TABLE "knowledge_categories" ADD CONSTRAINT "knowledge_categories_project_id_id_pk" PRIMARY KEY("project_id","id");
--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_project_id_id_pk" PRIMARY KEY("project_id","id");
--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_project_id_id_pk" PRIMARY KEY("project_id","id");
--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_project_id_id_pk" PRIMARY KEY("project_id","id");
--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_project_id_id_pk" PRIMARY KEY("project_id","id");
--> statement-breakpoint

-- Step 7: Create new composite FK constraints
ALTER TABLE "conversation_artifacts" ADD CONSTRAINT "conversation_artifacts_project_id_conversation_id_conversations_project_id_id_fk" FOREIGN KEY ("project_id","conversation_id") REFERENCES "public"."conversations"("project_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conversation_artifacts" ADD CONSTRAINT "conversation_artifacts_project_id_event_id_conversation_events_project_id_id_fk" FOREIGN KEY ("project_id","event_id") REFERENCES "public"."conversation_events"("project_id","id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_project_id_conversation_id_conversations_project_id_id_fk" FOREIGN KEY ("project_id","conversation_id") REFERENCES "public"."conversations"("project_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_project_id_category_id_knowledge_categories_project_id_id_fk" FOREIGN KEY ("project_id","category_id") REFERENCES "public"."knowledge_categories"("project_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_project_id_persona_id_personas_project_id_id_fk" FOREIGN KEY ("project_id","persona_id") REFERENCES "public"."personas"("project_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_project_id_default_classifier_id_classifiers_project_id_id_fk" FOREIGN KEY ("project_id","default_classifier_id") REFERENCES "public"."classifiers"("project_id","id") ON DELETE no action ON UPDATE no action;
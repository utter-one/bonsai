DROP TABLE "knowledge_sections" CASCADE;--> statement-breakpoint
ALTER TABLE "knowledge_categories" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "knowledge_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_categories" DROP COLUMN "knowledge_sections";--> statement-breakpoint
ALTER TABLE "stages" DROP COLUMN "knowledge_sections";
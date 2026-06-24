-- Add questions column with default empty array, nullable initially for safe migration
ALTER TABLE "knowledge_items" ADD COLUMN "questions" text[] DEFAULT '{}';

-- Backfill: copy existing question into questions array
UPDATE "knowledge_items" SET "questions" = ARRAY["question"] WHERE "question" IS NOT NULL;

-- Make questions NOT NULL and drop old column
ALTER TABLE "knowledge_items" ALTER COLUMN "questions" SET NOT NULL;
ALTER TABLE "knowledge_items" DROP COLUMN "question";

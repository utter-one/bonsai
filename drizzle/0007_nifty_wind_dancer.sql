ALTER TABLE "stages" ADD COLUMN "variable_descriptors" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stages" DROP COLUMN "variables";
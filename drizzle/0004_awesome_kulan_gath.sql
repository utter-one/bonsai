ALTER TABLE "stages" ADD COLUMN "default_classifier_id" text;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_default_classifier_id_classifiers_id_fk" FOREIGN KEY ("default_classifier_id") REFERENCES "public"."classifiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stages" DROP COLUMN "classifier_ids";
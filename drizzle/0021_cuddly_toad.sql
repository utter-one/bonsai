ALTER TABLE "admins" RENAME TO "operators";--> statement-breakpoint
ALTER TABLE "providers" DROP CONSTRAINT "providers_created_by_admins_id_fk";
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "filler_settings" jsonb;--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_created_by_operators_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "audit_logs" SET "entity_type" = 'operator' WHERE "entity_type" = 'admin';
ALTER TABLE "personas" RENAME TO "agents";--> statement-breakpoint
ALTER TABLE "stages" RENAME COLUMN "persona_id" TO "agent_id";--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT "personas_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT "personas_tts_provider_id_providers_id_fk";
--> statement-breakpoint
ALTER TABLE "stages" DROP CONSTRAINT "stages_project_id_persona_id_personas_project_id_id_fk";
--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT "personas_project_id_id_pk";--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_project_id_id_pk" PRIMARY KEY("project_id","id");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_tts_provider_id_providers_id_fk" FOREIGN KEY ("tts_provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_project_id_agent_id_agents_project_id_id_fk" FOREIGN KEY ("project_id","agent_id") REFERENCES "public"."agents"("project_id","id") ON DELETE no action ON UPDATE no action;
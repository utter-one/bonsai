-- Step 1: Drop the stage_tools FK that references stages(project_id, id)
ALTER TABLE "stage_tools" DROP CONSTRAINT "stage_tools_project_id_stage_id_stages_project_id_id_fk";
--> statement-breakpoint

-- Step 2: Drop the old stages primary key (project_id, id)
-- First drop any dependent FKs from legacy tables (e.g. stage_actions which may still exist in DB)
ALTER TABLE IF EXISTS "stage_actions" DROP CONSTRAINT IF EXISTS "stage_actions_project_id_stage_id_stages_project_id_id_fk";
--> statement-breakpoint
ALTER TABLE "stages" DROP CONSTRAINT "stages_project_id_id_pk";
--> statement-breakpoint

-- Step 3: Add flow_id as nullable so we can populate it before making it NOT NULL
ALTER TABLE "stages" ADD COLUMN "flow_id" text;
--> statement-breakpoint

-- Step 4: Create a default flow per project and assign all existing stages to it
DO $$
DECLARE
  proj RECORD;
  default_flow_id TEXT;
BEGIN
  FOR proj IN SELECT id FROM projects LOOP
    default_flow_id := 'flow_default_' || proj.id;
    INSERT INTO flows (id, project_id, name, description, version, created_at, updated_at)
    VALUES (default_flow_id, proj.id, 'Default Flow', 'Default flow created during migration', 1, now(), now())
    ON CONFLICT DO NOTHING;
    UPDATE stages SET flow_id = default_flow_id WHERE project_id = proj.id AND flow_id IS NULL;
  END LOOP;
END $$;
--> statement-breakpoint

-- Step 5: Make flow_id NOT NULL now that all rows have a value
ALTER TABLE "stages" ALTER COLUMN "flow_id" SET NOT NULL;
--> statement-breakpoint

-- Step 6: Add the new primary key (id, project_id, flow_id)
ALTER TABLE "stages" ADD CONSTRAINT "stages_id_project_id_flow_id_pk" PRIMARY KEY("id","project_id","flow_id");
--> statement-breakpoint

-- Step 7: Add FK for stages.flow_id -> flows(project_id, id)
ALTER TABLE "stages" ADD CONSTRAINT "stages_project_id_flow_id_flows_project_id_id_fk" FOREIGN KEY ("project_id","flow_id") REFERENCES "public"."flows"("project_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- Step 8: Add the new stage_tools FK referencing stages(id, project_id, flow_id)
ALTER TABLE "stage_tools" ADD CONSTRAINT "stage_tools_stage_id_project_id_flow_id_stages_id_project_id_flow_id_fk" FOREIGN KEY ("stage_id","project_id","flow_id") REFERENCES "public"."stages"("id","project_id","flow_id") ON DELETE cascade ON UPDATE no action;
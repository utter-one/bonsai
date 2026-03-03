-- Step 1: Drop existing FK from conversations to users
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_user_id_users_id_fk";
--> statement-breakpoint

-- Step 2: Drop the existing single-column primary key on users
ALTER TABLE "users" DROP CONSTRAINT "users_pkey";
--> statement-breakpoint

-- Step 3: Add project_id column (nullable initially, to allow backfill)
ALTER TABLE "users" ADD COLUMN "project_id" text;
--> statement-breakpoint

-- Step 4: Backfill — for every existing user, insert one copy per project
-- Original rows are identified by project_id IS NULL
INSERT INTO "users" ("id", "project_id", "profile", "created_at", "updated_at")
SELECT u.id, p.id, u.profile, u.created_at, u.updated_at
FROM "users" u
CROSS JOIN "projects" p
WHERE u.project_id IS NULL;
--> statement-breakpoint

-- Step 5: Delete the original project-less user rows
DELETE FROM "users" WHERE "project_id" IS NULL;
--> statement-breakpoint

-- Step 6: Make project_id NOT NULL now that all rows are backfilled
ALTER TABLE "users" ALTER COLUMN "project_id" SET NOT NULL;
--> statement-breakpoint

-- Step 7: Add FK from users.project_id to projects.id
ALTER TABLE "users" ADD CONSTRAINT "users_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Step 8: Add new composite primary key (project_id, id)
ALTER TABLE "users" ADD CONSTRAINT "users_project_id_id_pk" PRIMARY KEY("project_id","id");
--> statement-breakpoint

-- Step 9: Add composite FK from conversations (project_id, user_id) to users (project_id, id)
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_user_id_users_project_id_id_fk" FOREIGN KEY ("project_id","user_id") REFERENCES "public"."users"("project_id","id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "secrets" (
	"id" text PRIMARY KEY NOT NULL,
	"encrypted_value" text NOT NULL,
	"iv" text NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

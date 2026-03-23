ALTER TABLE "tools" ALTER COLUMN "prompt" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tools" ALTER COLUMN "input_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tools" ALTER COLUMN "output_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "type" text DEFAULT 'smart_function' NOT NULL;--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "webhook_method" text;--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "webhook_headers" jsonb;--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "webhook_body" text;--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "code" text;
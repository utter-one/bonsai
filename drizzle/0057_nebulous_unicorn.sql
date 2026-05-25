CREATE TABLE "benchmark_config_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"config_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"stats" jsonb,
	"started_at" timestamp,
	"completed_at" timestamp,
	"error" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"suite_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"provider_config_id" text NOT NULL,
	"input_type" text NOT NULL,
	"input_data" jsonb NOT NULL,
	"repeats" integer DEFAULT 3 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_provider_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider_type" text NOT NULL,
	"provider_id" text NOT NULL,
	"settings" jsonb NOT NULL,
  "provider_settings" jsonb,	
  "version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_results" (
	"id" text PRIMARY KEY NOT NULL,
	"config_execution_id" text NOT NULL,
	"iteration_index" integer NOT NULL,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"result" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"suite_id" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"error" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_suites" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"cron_expression" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "benchmark_config_executions" ADD CONSTRAINT "benchmark_config_executions_run_id_benchmark_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."benchmark_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_config_executions" ADD CONSTRAINT "benchmark_config_executions_config_id_benchmark_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."benchmark_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_configs" ADD CONSTRAINT "benchmark_configs_suite_id_benchmark_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."benchmark_suites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_configs" ADD CONSTRAINT "benchmark_configs_provider_config_id_benchmark_provider_configs_id_fk" FOREIGN KEY ("provider_config_id") REFERENCES "public"."benchmark_provider_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_provider_configs" ADD CONSTRAINT "benchmark_provider_configs_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_results" ADD CONSTRAINT "benchmark_results_config_execution_id_benchmark_config_executions_id_fk" FOREIGN KEY ("config_execution_id") REFERENCES "public"."benchmark_config_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_runs" ADD CONSTRAINT "benchmark_runs_suite_id_benchmark_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."benchmark_suites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_suites" ADD CONSTRAINT "benchmark_suites_created_by_operators_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_benchmark_config_executions_run_id" ON "benchmark_config_executions" USING btree ("run_id","config_id");--> statement-breakpoint
CREATE INDEX "idx_benchmark_configs_suite_id" ON "benchmark_configs" USING btree ("suite_id");--> statement-breakpoint
CREATE INDEX "idx_benchmark_results_config_execution_id" ON "benchmark_results" USING btree ("config_execution_id");--> statement-breakpoint
CREATE INDEX "idx_benchmark_runs_suite_id" ON "benchmark_runs" USING btree ("suite_id");--> statement-breakpoint
CREATE INDEX "idx_benchmark_runs_status" ON "benchmark_runs" USING btree ("status");

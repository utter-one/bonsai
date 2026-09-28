CREATE TABLE "alert_events" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"scope" jsonb,
	"severity" text NOT NULL,
	"status" text DEFAULT 'firing' NOT NULL,
	"message" text NOT NULL,
	"context" jsonb,
	"notifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fired_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"acked_at" timestamp,
	"acked_by" text
);
--> statement-breakpoint
CREATE TABLE "fallback_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"fallback_provider_id" text NOT NULL,
	"provider_type" text NOT NULL,
	"operation" text NOT NULL,
	"reason" text NOT NULL,
	"project_id" text,
	"conversation_id" text,
	"success" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"check_name" text NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer,
	"detail" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_samples" (
	"id" text PRIMARY KEY NOT NULL,
	"bucket" timestamp NOT NULL,
	"name" text NOT NULL,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"count" bigint NOT NULL,
	"sum" double precision,
	"min" double precision,
	"max" double precision,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_config" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"config" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_call_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"provider_type" text NOT NULL,
	"api_type" text NOT NULL,
	"operation" text NOT NULL,
	"model" text,
	"project_id" text,
	"conversation_id" text,
	"ok" boolean NOT NULL,
	"error_code" text,
	"status_http" integer,
	"duration_ms" integer NOT NULL,
	"error_text" text,
	"fallback_provider_id" text,
	"metrics" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_call_stats_hourly" (
	"hour_bucket" timestamp NOT NULL,
	"provider_id" text NOT NULL,
	"operation" text NOT NULL,
	"ok" boolean NOT NULL,
	"error_code" text DEFAULT 'none' NOT NULL,
	"count" bigint NOT NULL,
	"sum_duration_ms" bigint NOT NULL,
	"min_duration_ms" integer,
	"max_duration_ms" integer,
	"p95_duration_ms" double precision,
	"p50_ttft_ms" double precision,
	"p95_ttft_ms" double precision,
	"p99_ttft_ms" double precision,
	"p95_max_chunk_gap_ms" double precision,
	"stalled_count" integer DEFAULT 0 NOT NULL,
	"rtf_over_1_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "provider_call_stats_hourly_hour_bucket_provider_id_operation_ok_error_code_pk" PRIMARY KEY("hour_bucket","provider_id","operation","ok","error_code")
);
--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "fallbacks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_alert_events_fired_at" ON "alert_events" USING btree ("fired_at");--> statement-breakpoint
CREATE INDEX "idx_alert_events_scope_key_status" ON "alert_events" USING btree ("scope_key","status");--> statement-breakpoint
CREATE INDEX "idx_alert_events_rule_fired" ON "alert_events" USING btree ("rule_id","fired_at");--> statement-breakpoint
CREATE INDEX "idx_fallback_events_created_at" ON "fallback_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_fallback_events_provider_created" ON "fallback_events" USING btree ("provider_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_health_checks_check_created" ON "health_checks" USING btree ("check_name","created_at");--> statement-breakpoint
CREATE INDEX "idx_health_checks_created_at" ON "health_checks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_metric_samples_name_bucket" ON "metric_samples" USING btree ("name","bucket");--> statement-breakpoint
CREATE INDEX "idx_metric_samples_bucket" ON "metric_samples" USING btree ("bucket");--> statement-breakpoint
CREATE INDEX "idx_provider_call_logs_created_at" ON "provider_call_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_provider_call_logs_provider_created" ON "provider_call_logs" USING btree ("provider_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_provider_call_logs_project_created" ON "provider_call_logs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_provider_call_logs_conversation" ON "provider_call_logs" USING btree ("conversation_id");
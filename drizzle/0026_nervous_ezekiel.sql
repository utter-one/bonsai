CREATE INDEX "idx_api_keys_project_is_active" ON "api_keys" USING btree ("project_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_project_id" ON "audit_logs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_created_at" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_conversation_events_project_conversation" ON "conversation_events" USING btree ("project_id","conversation_id");--> statement-breakpoint
CREATE INDEX "idx_conversations_project_user" ON "conversations" USING btree ("project_id","user_id");
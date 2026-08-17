import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Monitoring configuration stored in the `monitoring_config` singleton row
 * (P1-06). Phase 1 notifier union is `webhook | email`; P4-02 extends the
 * enum with `telegram`/`sms` and their fields. Rule keys are validated
 * structurally here (non-empty string) — P2-01 tightens the schema with a
 * refine against the registered rule ids.
 *
 * Shared by `MonitoringConfigService` (validation on load/save) and the
 * P2-03 `PUT /api/monitoring/config` endpoint (request body).
 */

export const notifierConfigSchema = z
  .object({
    id: z.string().min(1).describe('Notifier id (synthesized on first boot for env-derived notifiers)'),
    type: z.enum(['webhook', 'email']).describe('Notifier type (Phase 1: webhook, email)'),
    channelProviderId: z
      .string()
      .min(1)
      .optional()
      .describe('Email channel provider id (required for email notifiers)'),
    url: z
      .string()
      .url()
      .optional()
      .describe('Webhook delivery URL, http(s) (required for webhook notifiers)'),
    to: z
      .string()
      .email()
      .optional()
      .describe('Recipient email address (required for email notifiers)'),
    minSeverity: z
      .enum(['info', 'warning', 'critical'])
      .optional()
      .describe('Only deliver alerts at or above this severity (default: all)'),
    enabled: z.boolean().describe('Disabled notifiers are skipped by the publisher'),
  })
  .refine((n) => n.type !== 'webhook' || (n.url ?? '').startsWith('http'), {
    message: 'Webhook notifiers require an http(s) url',
  })
  .refine((n) => n.type !== 'email' || Boolean(n.channelProviderId && n.to), {
    message: 'Email notifiers require channelProviderId and to',
  })
  .openapi('NotifierConfig');

export const ruleOverrideSchema = z
  .object({
    enabled: z.boolean().optional().describe('Disable the rule without deleting its override'),
    threshold: z.number().optional().describe('Rule threshold (rate, count, or ms — per-rule semantics)'),
    windowMinutes: z.number().positive().optional().describe('Evaluation window in minutes'),
    minSamples: z.number().int().positive().optional().describe('Minimum samples before the rule may fire'),
    forMinutes: z.number().min(0).optional().describe('Sustainment in minutes before firing'),
    resolveAfterGoodChecks: z.number().int().min(0).optional().describe('Consecutive good evaluations to auto-resolve'),
    cooldownMinutes: z.number().min(0).optional().describe('Minimum gap between re-fires of the same key'),
    maxUnresolvedHours: z.number().positive().optional().describe('Auto-resolve safety valve in hours'),
    severity: z.enum(['info', 'warning', 'critical']).optional().describe('Override the rule default severity'),
  })
  .openapi('RuleOverride');

export const probeSettingsSchema = z
  .object({
    llmProbe: z
      .enum(['models', 'one_token', 'off'])
      .default('models')
      .describe("LLM health probe mode: 'models' = enumerateModels() (free), 'one_token' = 1-token generation (costs money), 'off' = call-log inference only"),
    cooldownMinutes: z
      .number()
      .min(0)
      .default(10)
      .describe('Minimum minutes between probes of the same provider'),
  })
  .openapi('ProbeSettings');

export const alertingSettingsSchema = z
  .object({
    engineIntervalMinutes: z.number().min(1).default(1).describe('Alert rule engine interval in minutes (P2-01)'),
    defaultCooldownMinutes: z.number().min(0).default(15).describe('Default per-key re-fire cooldown in minutes (P2-01)'),
  })
  .openapi('AlertingSettings');

export const monitoringConfigSchema = z.object({
  notifiers: z
    .array(notifierConfigSchema)
    .default([])
    .describe('Alert delivery targets (webhook, email in Phase 1)'),
  rules: z
    .record(z.string().min(1), ruleOverrideSchema)
    .default({})
    .describe('Per-rule overrides keyed by rule id (P2-01 defines the ids)'),
  retentionDays: z
    .number()
    .int()
    .min(7)
    .default(90)
    .describe('Retention in days for provider_call_logs, health_checks, metric_samples (stats_hourly: 2x)'),
  // Factory-function defaults: a plain `.default({})` would insert a literal
  // empty object and skip the nested field defaults.
  probeSettings: probeSettingsSchema
    .default(() => probeSettingsSchema.parse({}))
    .describe('Provider health probe policy (P1-05 consumes this)'),
  alerting: alertingSettingsSchema
    .default(() => alertingSettingsSchema.parse({}))
    .describe('Alert engine settings (P2-01 consumes this)'),
});

export type MonitoringConfig = z.infer<typeof monitoringConfigSchema>;
export type NotifierConfig = z.infer<typeof notifierConfigSchema>;
export type RuleOverride = z.infer<typeof ruleOverrideSchema>;
export type ProbeSettings = z.infer<typeof probeSettingsSchema>;
export type AlertingSettings = z.infer<typeof alertingSettingsSchema>;

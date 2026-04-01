import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Cost management configuration schemas for controlling LLM token usage at the project level.
 * Caps apply per (providerApiType, model) pair and per request type.
 */

/**
 * Per-request-type token limit caps.
 * Each field limits the corresponding call type. Omit a field to apply no cap for that type.
 */
export const requestTypeLimitsSchema = z.object({
  completion: z.number().int().min(1).optional().describe('Maximum tokens for completion (response generation) calls'),
  classification: z.number().int().min(1).optional().describe('Maximum tokens for classifier calls'),
  tool: z.number().int().min(1).optional().describe('Maximum tokens for smart_function tool calls'),
  transformation: z.number().int().min(1).optional().describe('Maximum tokens for context transformer calls'),
  filler: z.number().int().min(1).optional().describe('Maximum tokens for filler sentence generation calls'),
}).openapi('RequestTypeLimits');

export type RequestTypeLimits = z.infer<typeof requestTypeLimitsSchema>;

/**
 * Output and input token limits for a specific provider + model combination.
 */
export const providerModelLimitsSchema = z.object({
  outputTokensLimits: requestTypeLimitsSchema.optional().describe('Maximum output token caps per request type. Enforced as a hard ceiling over the entity-level defaultMaxTokens.'),
  inputTokensLimits: requestTypeLimitsSchema.optional().describe('Maximum input context token caps per request type. When exceeded, the oldest non-system messages are trimmed from history before the call.'),
}).openapi('ProviderModelLimits');

export type ProviderModelLimits = z.infer<typeof providerModelLimitsSchema>;

/**
 * Project-level LLM cost management configuration.
 *
 * Structure: `limits[providerId][model]` where:
 * - `providerId` is the unique database ID of an LLM provider entity (e.g. `"prov_abc123"`)
 *   or `"*"` to match any provider.
 * - `model` is the model name (e.g. `"gpt-4o"`, `"claude-3-5-sonnet-20241022"`) or `"*"` to match any model.
 *
 * Lookup order (most specific wins, no merging):
 * 1. `[providerId][model]` — exact match
 * 2. `[providerId]["*"]` — any model for the given provider
 * 3. `["*"]["*"]` — global fallback
 *
 * All caps are optional; absent entries apply no limit.
 */
export const costManagementConfigSchema = z.object({
  limits: z.record(
    z.string().describe('Provider ID (e.g. "prov_abc123") or "*" for any provider'),
    z.record(
      z.string().describe('Model name (e.g. "gpt-4o") or "*" for any model'),
      providerModelLimitsSchema,
    ),
  ).describe('Token cap definitions keyed by provider API type and model name'),
}).openapi('CostManagementConfig');

export type CostManagementConfig = z.infer<typeof costManagementConfigSchema>;

import { z } from 'zod';
import { tokenUsageSchema, type TokenUsage } from '../services/providers/llm/ILlmProvider';

/**
 * Provider identification info captured alongside LLM token usage.
 */
export type LlmProviderInfo = {
  id: string;
  apiType: string;
};

/**
 * Extended token usage with provider and model identification for analytics.
 */
export const llmUsageMetadataSchema = tokenUsageSchema.extend({
  providerId: z.string().describe('ID of the LLM provider entity'),
  providerApiType: z.string().describe('API type of the LLM provider (e.g. openai, anthropic)'),
  model: z.string().optional().describe('Model name used for the generation'),
});

export type LlmUsageMetadata = z.infer<typeof llmUsageMetadataSchema>;

/**
 * Builds LLM usage metadata by combining token counts with provider identification.
 * Returns undefined if usage or provider info is not available.
 * @param usage - Token usage from LLM generation result
 * @param providerInfo - Provider entity info (id and apiType)
 * @param model - Model name from LLM settings
 */
export function buildLlmUsage(usage: TokenUsage | undefined, providerInfo: LlmProviderInfo | undefined, model: string | undefined): LlmUsageMetadata | undefined {
  if (!usage || !providerInfo) return undefined;
  return { ...usage, providerId: providerInfo.id, providerApiType: providerInfo.apiType, model };
}

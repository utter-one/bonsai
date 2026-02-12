import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { modelInfoSchema, voiceInfoSchema, languageInfoSchema, ttsModelInfoSchema, asrProviderInfoSchema, ttsProviderInfoSchema, llmProviderInfoSchema, providerCatalogSchema } from '../../services/providers/ProviderCatalogService';

extendZodWithOpenApi(z);

/**
 * Export schemas from ProviderCatalogService for use in API contracts
 */
export { modelInfoSchema, voiceInfoSchema, languageInfoSchema, ttsModelInfoSchema, asrProviderInfoSchema, ttsProviderInfoSchema, llmProviderInfoSchema, providerCatalogSchema };
export type { ModelInfo, VoiceInfo, LanguageInfo, TtsModelInfo, AsrProviderInfo, TtsProviderInfo, LlmProviderInfo, ProviderCatalog } from '../../services/providers/ProviderCatalogService';

/**
 * Schema for provider type route parameter
 */
export const providerTypeParamSchema = z.object({
  type: z.enum(['asr', 'tts', 'llm']).describe('Provider type (asr, tts, or llm)'),
});

export type ProviderTypeParam = z.infer<typeof providerTypeParamSchema>;

/**
 * Schema for specific provider route parameters
 */
export const specificProviderParamsSchema = z.object({
  type: z.enum(['asr', 'tts', 'llm']).describe('Provider type (asr, tts, or llm)'),
  apiType: z.string().describe('Provider API type (e.g., azure, elevenlabs, openai, anthropic)'),
});

export type SpecificProviderParams = z.infer<typeof specificProviderParamsSchema>;

/**
 * Schema for ASR providers list response
 */
export const asrProvidersResponseSchema = z.object({
  providers: z.array(asrProviderInfoSchema).describe('List of ASR providers'),
});

export type AsrProvidersResponse = z.infer<typeof asrProvidersResponseSchema>;

/**
 * Schema for TTS providers list response
 */
export const ttsProvidersResponseSchema = z.object({
  providers: z.array(ttsProviderInfoSchema).describe('List of TTS providers'),
});

export type TtsProvidersResponse = z.infer<typeof ttsProvidersResponseSchema>;

/**
 * Schema for LLM providers list response
 */
export const llmProvidersResponseSchema = z.object({
  providers: z.array(llmProviderInfoSchema).describe('List of LLM providers'),
});

export type LlmProvidersResponse = z.infer<typeof llmProvidersResponseSchema>;

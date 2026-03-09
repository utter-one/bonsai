import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { asrModelInfoSchema, llmModelInfoSchema, voiceInfoSchema, languageInfoSchema, ttsModelInfoSchema, asrProviderInfoSchema, ttsProviderInfoSchema, llmProviderInfoSchema, storageProviderInfoSchema, moderationCategoryInfoSchema, moderationModelInfoSchema, moderationProviderInfoSchema, providerCatalogSchema } from '../../services/providers/ProviderCatalogService';

extendZodWithOpenApi(z);

/**
 * Export schemas from ProviderCatalogService for use in API contracts
 */
export { asrModelInfoSchema, llmModelInfoSchema, voiceInfoSchema, languageInfoSchema, ttsModelInfoSchema, asrProviderInfoSchema, ttsProviderInfoSchema, llmProviderInfoSchema, storageProviderInfoSchema, moderationCategoryInfoSchema, moderationModelInfoSchema, moderationProviderInfoSchema, providerCatalogSchema };
export type { AsrModelInfo, LlmModelInfo, VoiceInfo, LanguageInfo, TtsModelInfo, AsrProviderInfo, TtsProviderInfo, LlmProviderInfo, StorageProviderInfo, ModerationCategoryInfo, ModerationModelInfo, ModerationProviderInfo, ProviderCatalog } from '../../services/providers/ProviderCatalogService';

/**
 * Schema for provider type route parameter
 */
export const providerTypeParamSchema = z.object({
  type: z.enum(['asr', 'tts', 'llm', 'storage', 'moderation']).describe('Provider type (asr, tts, llm, storage, or moderation)'),
});

export type ProviderTypeParam = z.infer<typeof providerTypeParamSchema>;

/**
 * Schema for specific provider route parameters
 */
export const specificProviderParamsSchema = z.object({
  type: z.enum(['asr', 'tts', 'llm', 'storage', 'moderation']).describe('Provider type (asr, tts, llm, storage, or moderation)'),
  apiType: z.string().describe('Provider API type (e.g., azure, elevenlabs, openai, anthropic, s3, azure-blob, gcs, local)'),
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

/**
 * Schema for storage providers list response
 */
export const storageProvidersResponseSchema = z.object({
  providers: z.array(storageProviderInfoSchema).describe('List of storage providers'),
});

export type StorageProvidersResponse = z.infer<typeof storageProvidersResponseSchema>;

/**
 * Schema for moderation providers list response
 */
export const moderationProvidersResponseSchema = z.object({
  providers: z.array(moderationProviderInfoSchema).describe('List of moderation providers'),
});

export type ModerationProvidersResponse = z.infer<typeof moderationProvidersResponseSchema>;

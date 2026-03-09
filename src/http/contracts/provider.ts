import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, listResponseLimitSchema } from './common';
import type { ListParams } from './common';
import { llmModelInfoSchema } from '../../services/providers/ProviderCatalogService';

// Import provider config schemas
import { openAILlmProviderConfigSchema } from '../../services/providers/llm/OpenAILlmProvider';
import { openAILegacyLlmProviderConfigSchema } from '../../services/providers/llm/OpenAILegacyLlmProvider';
import { anthropicLlmProviderConfigSchema } from '../../services/providers/llm/AnthropicLlmProvider';
import { geminiLlmProviderConfigSchema } from '../../services/providers/llm/GeminiLlmProvider';
import { elevenLabsTtsProviderConfigSchema } from '../../services/providers/tts/ElevenLabsTtsProvider';
import { openAiTtsProviderConfigSchema } from '../../services/providers/tts/OpenAiTtsProvider';
import { deepgramTtsProviderConfigSchema } from '../../services/providers/tts/DeepgramTtsProvider';
import { cartesiaTtsProviderConfigSchema } from '../../services/providers/tts/CartesiaTtsProvider';
import { azureTtsProviderConfigSchema } from '../../services/providers/tts/AzureTtsProvider';
import { azureAsrProviderConfigSchema } from '../../services/providers/asr/AzureAsrProvider';
import { elevenLabsAsrProviderConfigSchema } from '../../services/providers/asr/ElevenLabsAsrProvider';
import { deepgramAsrProviderConfigSchema } from '../../services/providers/asr/DeepgramAsrProvider';
import { assemblyAiAsrProviderConfigSchema } from '../../services/providers/asr/AssemblyAiAsrProvider';
import { speechmaticsAsrProviderConfigSchema } from '../../services/providers/asr/SpeechmaticsAsrProvider';
import { s3StorageProviderConfigSchema } from '../../services/providers/storage/S3StorageProvider';
import { azureBlobStorageProviderConfigSchema } from '../../services/providers/storage/AzureBlobStorageProvider';
import { gcsStorageProviderConfigSchema } from '../../services/providers/storage/GcsStorageProvider';
import { localStorageProviderConfigSchema } from '../../services/providers/storage/LocalStorageProvider';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/**
 * Union schema for all LLM provider configurations
 */
export const llmProviderConfigSchema = z.union([
  openAILlmProviderConfigSchema,
  openAILegacyLlmProviderConfigSchema,
  anthropicLlmProviderConfigSchema,
  geminiLlmProviderConfigSchema,
]).describe('LLM provider configuration');

/**
 * Union schema for all TTS provider configurations
 */
export const ttsProviderConfigSchema = z.union([
  elevenLabsTtsProviderConfigSchema,
  openAiTtsProviderConfigSchema,
  deepgramTtsProviderConfigSchema,
  cartesiaTtsProviderConfigSchema,
  azureTtsProviderConfigSchema,
]).describe('TTS provider configuration');

/**
 * Union schema for all ASR provider configurations
 */
export const asrProviderConfigSchema = z.union([
  azureAsrProviderConfigSchema,
  elevenLabsAsrProviderConfigSchema,
  deepgramAsrProviderConfigSchema,
  assemblyAiAsrProviderConfigSchema,
  speechmaticsAsrProviderConfigSchema,
]).describe('ASR provider configuration');

/**
 * Union schema for all storage provider configurations
 */
export const storageProviderConfigSchema = z.union([
  s3StorageProviderConfigSchema,
  azureBlobStorageProviderConfigSchema,
  gcsStorageProviderConfigSchema,
  localStorageProviderConfigSchema,
]).describe('Storage provider configuration');

export type StorageProviderConfig = z.infer<typeof storageProviderConfigSchema>;

/**
 * Union schema for all provider configurations
 */
export const providerConfigSchema = z.union([
  llmProviderConfigSchema,
  ttsProviderConfigSchema,
  asrProviderConfigSchema,
  storageProviderConfigSchema,
]).describe('Provider-specific configuration object');

export type ProviderConfig = z.infer<typeof providerConfigSchema>;

// Route param schema
export const providerRouteParamsSchema = z.object({
  id: z.string().describe('Provider ID'),
});

/**
 * Enum for provider types
 */
export const providerTypeSchema = z.enum(['asr', 'tts', 'llm', 'embeddings', 'storage']).describe('Type of provider service');

/**
 * Provider name (openai, anthropic, azure, elevenlabs, etc.)
 */
export const providerNameSchema = z.string().describe('Specific provider implementation');

/**
 * Schema for creating a new provider
 * Required fields: id, displayName, type, providerName, config
 * Optional fields: description, createdBy, tags
 */
export const createProviderSchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier for the provider (auto-generated if not provided)'),
  name: z.string().min(1).describe('Human-readable name for the provider'),
  description: z.string().optional().describe('Detailed description of provider purpose and use case'),
  providerType: providerTypeSchema.describe('Provider category: asr, tts, llm, or embeddings'),
  apiType: providerNameSchema.describe('Specific provider implementation (e.g., openai, anthropic, azure, elevenlabs)'),
  config: providerConfigSchema.describe('Provider-specific configuration object (varies by providerType and apiType)'),
  createdBy: z.string().optional().describe('Operator user ID who created the provider'),
  tags: z.array(z.string()).optional().describe('Searchable tags for organization (e.g., ["production", "low-latency"])'),
});

/**
 * Schema for updating a provider
 * Required fields: version (for optimistic locking)
 * Optional fields: displayName, description, type, providerName, config, tags
 */
export const updateProviderBodySchema = z.object({
  version: z.number().int().positive().describe('Current version number for optimistic locking (prevents concurrent updates)'),
  name: z.string().min(1).optional().describe('Updated human-readable name for the provider'),
  description: z.string().optional().describe('Updated description of provider purpose'),
  providerType: providerTypeSchema.optional().describe('Updated provider category'),
  apiType: providerNameSchema.optional().describe('Updated specific provider implementation'),
  config: providerConfigSchema.optional().describe('Updated provider-specific configuration'),
  tags: z.array(z.string()).optional().describe('Updated searchable tags'),
});

/**
 * Schema for deleting a provider
 * Required fields: version (for optimistic locking to prevent concurrent deletions)
 */
export const deleteProviderBodySchema = z.object({
  version: z.number().int().positive().describe('Current version number for optimistic locking (prevents concurrent deletions)'),
});

/**
 * Schema for provider response
 * Includes: id, name, description, type, providerName, config, createdBy, tags, version, createdAt, updatedAt
 */
export const providerResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the provider'),
  name: z.string().describe('Human-readable name of the provider'),
  description: z.string().nullable().describe('Description of provider purpose and use case'),
  providerType: providerTypeSchema.describe('Provider category (asr, tts, llm, embeddings)'),
  apiType: providerNameSchema.describe('Specific provider implementation'),
  config: providerConfigSchema.describe('Provider-specific configuration object'),
  createdBy: z.string().nullable().describe('Operator user ID who created the provider'),
  tags: z.array(z.string()).nullable().describe('Tags for organization and search'),
  version: z.number().int().describe('Current version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the provider was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the provider was last updated'),
});

/**
 * Schema for paginated list of providers
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const providerListResponseSchema = z.object({
  items: z.array(providerResponseSchema).describe('Array of providers in the current page'),
  total: z.number().int().min(0).describe('Total number of providers matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

/** Request body for creating a new provider */
export type CreateProviderRequest = z.infer<typeof createProviderSchema>;

/** Request body for updating a provider (includes version for optimistic locking) */
export type UpdateProviderRequest = z.infer<typeof updateProviderBodySchema>;

/** Request body for deleting a provider (includes version for optimistic locking) */
export type DeleteProviderRequest = z.infer<typeof deleteProviderBodySchema>;

/** Response for a single provider */
export type ProviderResponse = z.infer<typeof providerResponseSchema>;

/** Response for paginated list of providers with metadata */
export type ProviderListResponse = z.infer<typeof providerListResponseSchema>;

/** Type for provider types */
export type ProviderType = z.infer<typeof providerTypeSchema>;

/** Type for provider names */
export type ProviderName = z.infer<typeof providerNameSchema>;

/**
 * Schema for LLM model enumeration response
 */
export const providerModelsResponseSchema = z.object({
  models: z.array(llmModelInfoSchema).describe('Available models for the provider'),
});

/** Response for model enumeration */
export type ProviderModelsResponse = z.infer<typeof providerModelsResponseSchema>;

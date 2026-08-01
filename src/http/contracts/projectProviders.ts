import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { providerTypeSchema } from './provider';

extendZodWithOpenApi(z);

/**
 * Schema for route params of the project provider usage endpoint
 */
export const projectProviderUsageRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
});

export type ProjectProviderUsageRouteParams = z.infer<typeof projectProviderUsageRouteParamsSchema>;

/**
 * Schema for query params of the project provider usage endpoint
 */
export const projectProviderUsageQuerySchema = z.object({
  checkIfAvailable: z.coerce.boolean().default(false).describe('When true, checks whether each provider\'s configured models are still available by querying the provider API (LLM providers only). Each provider check has a 10-second timeout.'),
});

export type ProjectProviderUsageQuery = z.infer<typeof projectProviderUsageQuerySchema>;

/**
 * Entity types that can reference providers
 */
export const entityTypeSchema = z.enum(['agent', 'stage', 'classifier', 'tool', 'contextTransformer', 'tester', 'project']).describe('Type of entity referencing the provider');

export type EntityType = z.infer<typeof entityTypeSchema>;

/**
 * A single usage reference showing which entity uses a provider
 */
export const providerUsageEntrySchema = z.object({
  entityType: entityTypeSchema,
  entityId: z.string().describe('ID of the entity using this provider'),
  entityName: z.string().describe('Name of the entity using this provider'),
  modelName: z.string().nullable().optional().describe('LLM or TTS model name configured on the entity (only set when the entity has llmSettings/ttsSettings with a model field)'),
}).openapi('ProviderUsageEntry').describe('Single entity reference using this provider');

export type ProviderUsageEntry = z.infer<typeof providerUsageEntrySchema>;

/**
 * Status of a single model within a provider's availability check
 */
export const modelAvailabilitySchema = z.object({
  model: z.string().describe('Model name as configured on the entity'),
  status: z.enum(['available', 'unavailable']).describe('Whether the model is available on the provider'),
  usedBy: z.array(z.string()).describe('List of entity IDs that depend on this model'),
}).openapi('ModelAvailability').describe('Availability status of a single model');

export type ModelAvailability = z.infer<typeof modelAvailabilitySchema>;

/**
 * Availability information for a provider
 */
export const providerAvailabilitySchema = z.object({
  status: z.enum(['available', 'partially_available', 'unavailable', 'not_applicable']).describe('Overall availability: available (all models OK), partially_available (some models missing), unavailable (no models OK), not_applicable (non-LLM provider)'),
  models: z.array(modelAvailabilitySchema).describe('Per-model availability breakdown (only populated when checkIfAvailable is true and provider is LLM)'),
}).openapi('ProviderAvailability').describe('Availability information for a provider');

export type ProviderAvailability = z.infer<typeof providerAvailabilitySchema>;

/**
 * Detail about a single provider used in the project
 */
export const usedProviderDetailSchema = z.object({
  id: z.string().describe('Provider ID'),
  name: z.string().describe('Provider display name'),
  providerType: providerTypeSchema,
  apiType: z.string().describe('Specific provider implementation (e.g., openai, anthropic, elevenlabs)'),
  usage: z.array(providerUsageEntrySchema).describe('List of entities within the project that reference this provider'),
  availability: providerAvailabilitySchema.optional().describe('Availability check results (only populated when checkIfAvailable query parameter is true)'),
}).openapi('UsedProviderDetail').describe('Provider with its usage references within the project');

export type UsedProviderDetail = z.infer<typeof usedProviderDetailSchema>;

/**
 * Summary of providers grouped by type
 */
export const providerTypeSummarySchema = z.object({
  llm: z.number().int().min(0).describe('Number of LLM providers used'),
  tts: z.number().int().min(0).describe('Number of TTS providers used'),
  asr: z.number().int().min(0).describe('Number of ASR providers used'),
  embeddings: z.number().int().min(0).describe('Number of embeddings providers used'),
  storage: z.number().int().min(0).describe('Number of storage providers used'),
  channel: z.number().int().min(0).describe('Number of channel providers used'),
}).openapi('ProviderTypeSummary').describe('Count of providers grouped by type');

export type ProviderTypeSummary = z.infer<typeof providerTypeSummarySchema>;

/**
 * Response schema for the project provider usage endpoint
 */
export const projectProviderUsageResponseSchema = z.object({
  providers: z.array(usedProviderDetailSchema).describe('List of providers actively referenced by entities in the project'),
  summary: z.object({
    totalProviders: z.number().int().min(0).describe('Total number of distinct providers used in the project'),
    byType: providerTypeSummarySchema,
  }).describe('Summary statistics of provider usage'),
}).openapi('ProjectProviderUsageResponse').describe('Comprehensive report of providers used in the project');

export type ProjectProviderUsageResponse = z.infer<typeof projectProviderUsageResponseSchema>;

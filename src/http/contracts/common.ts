import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { openAILlmSettingsSchema } from '../../services/providers/llm/OpenAILlmProvider';
import { openAILegacyLlmSettingsSchema } from '../../services/providers/llm/OpenAILegacyLlmProvider';
import { anthropicLlmSettingsSchema } from '../../services/providers/llm/AnthropicLlmProvider';
import { geminiLlmSettingsSchema } from '../../services/providers/llm/GeminiLlmProvider';
import { elevenLabsTtsSettingsSchema } from '../../services/providers/tts/ElevenLabsTtsProvider';
import { openAiTtsSettingsSchema } from '../../services/providers/tts/OpenAiTtsProvider';
import { deepgramTtsSettingsSchema } from '../../services/providers/tts/DeepgramTtsProvider';
import { cartesiaTtsSettingsSchema } from '../../services/providers/tts/CartesiaTtsProvider';
import { azureTtsSettingsSchema } from '../../services/providers/tts/AzureTtsProvider';

extendZodWithOpenApi(z);

// ==================
// List Params Schema
// ==================

/**
 * Schema for filter operations with explicit operator and value
 * Supports: eq, ne, gt, gte, lt, lte, like, in, nin, between
 */
const listFilterOperationSchema = z.object({
  op: z.enum(['like', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'between']).describe('Filter operator: eq (equals), ne (not equals), gt (greater than), gte (>=), lt (less than), lte (<=), like (pattern match), in (value in array), nin (not in array), between (range)'),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.array(z.number()),
    z.array(z.boolean()),
  ]).describe('Filter value to compare against. For "in", "nin", and "between" operations, use an array'),
}).openapi('ListFilterOperation').describe('Filter operation with explicit operator and value');

/**
 * Schema for flexible filter values
 * Can be a direct value, array (for IN operations), or an operation object
 */
const listFilterSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.number()),
  z.array(z.boolean()),
  listFilterOperationSchema,
]);

/**
 * Schema for list query parameters supporting filtering, sorting, pagination, and search
 * Query params:
 * - offset: Starting index for pagination (default: 0)
 * - limit: Maximum number of items to return (optional)
 * - textSearch: Full-text search query (optional)
 * - orderBy: Field(s) to sort by. Use '-' prefix for descending (e.g., '-createdAt')
 * - groupBy: Field(s) to group results by (optional)
 * - filters: Dynamic field filters as key-value pairs (use bracket notation: filters[projectId]=value)
 */
export const listParamsSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0).describe('Starting index for pagination (default: 0)'),
  limit: z.coerce.number().int().positive().nullable().optional().describe('Maximum number of items to return (optional, null for no limit)'),
  textSearch: z.string().nullable().optional().describe('Full-text search query string (optional)'),
  orderBy: z.union([z.string(), z.array(z.string())]).nullable().optional().describe('Field(s) to sort by. Use "-" prefix for descending order (e.g., "-createdAt")'),
  groupBy: z.union([z.string(), z.array(z.string())]).nullable().optional().describe('Field(s) to group results by (optional)'),
  filters: z.record(z.string(), listFilterSchema).nullable().optional().describe('Dynamic field filters as key-value pairs. Use bracket notation in query string (e.g., filters[projectId]=value, filters[name][op]=like&filters[name][value]=test). Values can be direct values, arrays (for IN), or operation objects'),
}).openapi('ListParams').describe('List query parameters for filtering, sorting, pagination, and search');

/** Filter operation with explicit operator (eq, ne, gt, gte, lt, lte, like, in, nin, between) and value */
export type ListFilterOperation = z.infer<typeof listFilterOperationSchema>;

/** Flexible filter value: direct value, array, or operation object */
export type ListFilter = z.infer<typeof listFilterSchema>;

/** List query parameters for filtering, sorting, pagination, and search */
export type ListParams = z.infer<typeof listParamsSchema>;

/**
 * Schema for route params of project-scoped endpoints
 */
export const projectScopedParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
});

export type ProjectScopedParams = z.infer<typeof projectScopedParamsSchema>;

// ====================
// LLM Settings Schemas
// ====================

/**
 * Discriminated union of all LLM settings types
 * Each settings object contains provider-specific configuration for LLM generation
 * Individual schemas are defined in their respective provider files
 */
export const llmSettingsSchema = z.union([
  openAILlmSettingsSchema,
  openAILegacyLlmSettingsSchema,
  anthropicLlmSettingsSchema,
  geminiLlmSettingsSchema,
]).openapi('LlmSettings').nullable().optional().describe('LLM provider-specific settings for this stage');

// ====================
// TTS Settings Schemas
// ====================

/**
 * Discriminated union of all TTS settings types
 * Each settings object contains provider-specific configuration for TTS generation
 * Individual schemas are defined in their respective provider files
 * Uses a 'provider' discriminator field to identify the correct schema
 */
export const ttsSettingsSchema = z.discriminatedUnion('provider', [
  elevenLabsTtsSettingsSchema,
  openAiTtsSettingsSchema,
  deepgramTtsSettingsSchema,
  cartesiaTtsSettingsSchema,
  azureTtsSettingsSchema,
]).openapi('TtsSettings').nullable().optional().describe('TTS provider-specific settings');

export type TtsSettings = z.infer<typeof ttsSettingsSchema>;

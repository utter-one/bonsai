import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, listResponseLimitSchema, llmSettingsSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

/**
 * Schema for tester route params
 */
export const testerRouteParamsSchema = z.object({
  projectId: z.string().min(1).describe('Project ID'),
  id: z.string().describe('Tester ID'),
});

/**
 * Schema for creating a new tester persona
 */
export const createTesterSchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier for the tester (auto-generated if not provided)'),
  name: z.string().min(1).describe('Display name of the tester persona'),
  description: z.string().nullable().optional().describe('Detailed description of the tester persona and its behaviour'),
  prompt: z.string().min(1).describe('Prompt that defines the tester persona behaviour during a conversation'),
  hangUpPrompt: z.string().nullable().optional().describe('Mini-prompt evaluated at each turn to decide whether the tester should hang up (used when personaCanHangUp is enabled on the scenario); must return true to continue or false to hang up'),
  llmProviderId: z.string().min(1).optional().describe('ID of the LLM provider to use for this tester'),
  llmSettings: llmSettingsSchema.unwrap().unwrap().optional().describe('LLM provider-specific settings for this tester'),
  userProfile: z.record(z.string(), z.unknown()).optional().describe('Key-value user profile data passed when the tester starts a conversation'),
  tags: z.array(z.string()).optional().default([]).describe('Tags for categorizing and filtering this tester'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional tester-specific metadata'),
});

/**
 * Schema for updating a tester
 * All fields are optional except version for optimistic locking
 */
export const updateTesterBodySchema = z.object({
  name: z.string().min(1).optional().describe('Updated display name'),
  description: z.string().nullable().optional().describe('Updated description'),
  prompt: z.string().min(1).optional().describe('Updated persona prompt'),
  hangUpPrompt: z.string().nullable().optional().describe('Updated hang-up decision mini-prompt'),
  llmProviderId: z.string().min(1).optional().describe('Updated LLM provider ID'),
  llmSettings: llmSettingsSchema.unwrap().unwrap().optional().describe('Updated LLM provider-specific settings'),
  userProfile: z.record(z.string(), z.unknown()).optional().describe('Updated user profile data'),
  tags: z.array(z.string()).optional().describe('Updated tags'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Updated metadata'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for deleting a tester
 */
export const deleteTesterBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for tester response
 */
export const testerResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the tester'),
  projectId: z.string().describe('ID of the project this tester belongs to'),
  name: z.string().describe('Display name of the tester persona'),
  description: z.string().nullable().describe('Detailed description of the tester persona'),
  prompt: z.string().describe('Prompt that defines the tester persona behaviour'),
  hangUpPrompt: z.string().nullable().describe('Mini-prompt evaluated at each turn to decide whether the tester should hang up'),
  llmProviderId: z.string().nullable().describe('ID of the LLM provider'),
  llmSettings: llmSettingsSchema.describe('LLM provider-specific settings'),
  userProfile: z.record(z.string(), z.unknown()).nullable().describe('Key-value user profile data'),
  tags: z.array(z.string()).describe('Tags for categorizing and filtering this tester'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional metadata'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the tester was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the tester was last updated'),
});

/**
 * Schema for paginated list of testers
 */
export const testerListResponseSchema = z.object({
  items: z.array(testerResponseSchema).describe('Array of testers in the current page'),
  total: z.number().int().min(0).describe('Total number of testers matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: listResponseLimitSchema,
});

/** Request body for creating a new tester */
export type CreateTesterRequest = z.infer<typeof createTesterSchema>;

/** Request body for updating a tester */
export type UpdateTesterRequest = z.infer<typeof updateTesterBodySchema>;

/** Request body for deleting a tester */
export type DeleteTesterRequest = z.infer<typeof deleteTesterBodySchema>;

/** Response for a single tester */
export type TesterResponse = z.infer<typeof testerResponseSchema>;

/** Response for paginated list of testers */
export type TesterListResponse = z.infer<typeof testerListResponseSchema>;

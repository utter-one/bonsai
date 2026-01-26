import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema } from './common';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

// Route param schema
export const personaRouteParamsSchema = z.object({
  id: z.string().describe('Persona ID'),
});

/**
 * Schema for voice configuration settings
 * Provides configuration for text-to-speech voice synthesis
 */
export const voiceConfigSchema = z.object({
  voiceProviderId: z.string().optional().describe('ID of the voice provider (e.g., "eleven-labs")'),
  voiceId: z.string().optional().describe('Text-to-speech voice identifier'),
  settings: z.record(z.string(), z.unknown()).optional().describe('Voice-specific settings including model, speed, stability, etc.'),
}).optional().describe('Voice configuration for TTS');

export type VoiceConfig = z.infer<typeof voiceConfigSchema>;

/**
 * Schema for creating a new persona
 * Required fields: id, name, prompt
 * Optional fields: voiceConfig, metadata
 */
export const createPersonaSchema = z.object({
  id: z.string().min(1).describe('Unique identifier for the persona'),
  projectId: z.string().min(1).describe('ID of the project this persona belongs to'),
  name: z.string().min(1).describe('Display name of the persona'),
  prompt: z.string().min(1).describe('Detailed prompt defining the persona\'s characteristics and behavior'),
  voiceConfig: voiceConfigSchema.describe('Optional voice configuration settings for TTS'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional persona-specific metadata'),
});

/**
 * Schema for updating a persona
 * Optional fields: name, prompt, voiceConfig, metadata, version
 * Version is required for optimistic locking
 */
export const updatePersonaBodySchema = z.object({
  name: z.string().min(1).optional().describe('Updated display name'),
  prompt: z.string().min(1).optional().describe('Updated prompt defining behavior'),
  voiceConfig: voiceConfigSchema.describe('Updated voice configuration'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Updated metadata'),
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for deleting a persona
 * Required field: version for optimistic locking
 */
export const deletePersonaBodySchema = z.object({
  version: z.number().int().min(1).describe('Current version number for optimistic locking'),
});

/**
 * Schema for persona response
 * Includes: id, name, prompt, voiceConfig, metadata, version, createdAt, updatedAt
 */
export const personaResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the persona'),
  projectId: z.string().describe('ID of the project this persona belongs to'),
  name: z.string().describe('Display name of the persona'),
  prompt: z.string().describe('Prompt defining the persona\'s characteristics and behavior'),
  voiceProviderId: z.string().describe('ID of the voice provider used for TTS, if any'),
  voiceConfig: voiceConfigSchema.describe('Voice configuration settings'),
  metadata: z.record(z.string(), z.unknown()).nullable().describe('Additional persona-specific metadata'),
  version: z.number().int().describe('Version number for optimistic locking'),
  createdAt: z.coerce.date().describe('Timestamp when the persona was created'),
  updatedAt: z.coerce.date().describe('Timestamp when the persona was last updated'),
});

/**
 * Schema for paginated list of personas
 * Includes pagination metadata: items, total count, offset, and limit
 */
export const personaListResponseSchema = z.object({
  items: z.array(personaResponseSchema).describe('Array of personas in the current page'),
  total: z.number().int().min(0).describe('Total number of personas matching the query'),
  offset: z.number().int().min(0).describe('Starting index of the current page'),
  limit: z.number().int().positive().nullable().describe('Maximum number of items per page (null if no limit)'),
});

/** Request body for creating a new persona */
export type CreatePersonaRequest = z.infer<typeof createPersonaSchema>;

/** Request body for updating a persona */
export type UpdatePersonaRequest = z.infer<typeof updatePersonaBodySchema>;

/** Request body for deleting a persona */
export type DeletePersonaRequest = z.infer<typeof deletePersonaBodySchema>;

/** Response for a single persona */
export type PersonaResponse = z.infer<typeof personaResponseSchema>;

/** Response for paginated list of personas with metadata */
export type PersonaListResponse = z.infer<typeof personaListResponseSchema>;

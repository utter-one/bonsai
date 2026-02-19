import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { listParamsSchema, ttsSettingsSchema } from './common';
import { audioFormatValues } from '../../types/audio';
import type { ListParams } from './common';

extendZodWithOpenApi(z);

export { listParamsSchema, type ListParams };

// Route param schema
export const personaRouteParamsSchema = z.object({
  id: z.string().describe('Persona ID'),
});

/**
 * Schema for creating a new persona
 * Required fields: id, name, prompt
 * Optional fields: description, ttsSettings, metadata
 */
export const createPersonaSchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier for the persona (auto-generated if not provided)'),
  projectId: z.string().min(1).describe('ID of the project this persona belongs to'),
  name: z.string().min(1).describe('Display name of the persona'),
  description: z.string().optional().describe('Detailed description of the persona purpose'),
  prompt: z.string().min(1).describe('Detailed prompt defining the persona\'s characteristics and behavior'),
  ttsProviderId: z.string().optional().describe('ID of the TTS provider (e.g., "eleven-labs")'),
  ttsSettings: ttsSettingsSchema.describe('TTS provider-specific settings'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional persona-specific metadata'),
});

/**
 * Schema for updating a persona
 * Optional fields: name, description, prompt, ttsSettings, metadata, version
 * Version is required for optimistic locking
 */
export const updatePersonaBodySchema = z.object({
  name: z.string().min(1).optional().describe('Updated display name'),
  description: z.string().optional().describe('Updated detailed description of the persona'),
  prompt: z.string().min(1).optional().describe('Updated prompt defining behavior'),
  ttsProviderId: z.string().optional().describe('Updated TTS provider ID'),
  ttsSettings: ttsSettingsSchema.describe('Updated TTS provider-specific settings'),
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
 * Includes: id, name, description, prompt, ttsSettings, metadata, version, createdAt, updatedAt
 */
export const personaResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the persona'),
  projectId: z.string().describe('ID of the project this persona belongs to'),
  name: z.string().describe('Display name of the persona'),
  description: z.string().nullable().describe('Detailed description of the persona purpose'),
  prompt: z.string().describe('Prompt defining the persona\'s characteristics and behavior'),
  ttsProviderId: z.string().nullable().describe('ID of the TTS provider'),
  ttsSettings: ttsSettingsSchema.nullable().describe('TTS provider-specific settings'),
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

/**
 * Schema for cloning a persona
 * All fields are optional - id defaults to auto-generated, name defaults to "{original name} (Clone)"
 */
export const clonePersonaSchema = z.object({
  id: z.string().min(1).optional().describe('New ID for the cloned persona (auto-generated if not provided)'),
  name: z.string().min(1).optional().describe('Name for the cloned persona (defaults to "{original name} (Clone)")'),
});

/** Request body for creating a new persona */
export type CreatePersonaRequest = z.infer<typeof createPersonaSchema>;

/** Request body for updating a persona */
export type UpdatePersonaRequest = z.infer<typeof updatePersonaBodySchema>;

/** Request body for deleting a persona */
export type DeletePersonaRequest = z.infer<typeof deletePersonaBodySchema>;

/** Request body for cloning a persona */
export type ClonePersonaRequest = z.infer<typeof clonePersonaSchema>;

/** Response for a single persona */
export type PersonaResponse = z.infer<typeof personaResponseSchema>;

/** Response for paginated list of personas with metadata */
export type PersonaListResponse = z.infer<typeof personaListResponseSchema>;

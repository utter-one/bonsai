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
 * Voice-specific settings for ElevenLabs TTS provider
 */
export const voiceConfigSchema = z.object({
  model: z.string().optional().describe('Model ID to use for speech synthesis (e.g., "eleven_flash_v2_5", "eleven_multilingual_v2")'),
  voiceId: z.string().optional().describe('Text-to-speech voice identifier'),
  noSpeechMarkers: z.array(z.object({ start: z.string(), end: z.string() })).optional().describe('Markers to identify sections of text that should not be spoken'),
  removeExclamationMarks: z.boolean().optional().describe('Whether to replace exclamation marks with periods'),
  stability: z.number().min(0).max(1).nullable().optional().describe('Voice stability setting (0.0-1.0), defaults to 0.5'),
  similarityBoost: z.number().min(0).max(1).nullable().optional().describe('Similarity boost setting (0.0-1.0), defaults to 0.75'),
  style: z.number().min(0).max(1).nullable().optional().describe('Style setting for V2+ models (0.0-1.0), defaults to 0'),
  useSpeakerBoost: z.boolean().nullable().optional().describe('Enable speaker boost for V2+ models, defaults to true'),
  speed: z.number().min(0.7).max(1.2).nullable().optional().describe('Speech speed (0.7-1.2), defaults to 1.0'),
  useGlobalPreview: z.boolean().optional().describe('Use global preview endpoint for geographic proximity optimization'),
  inactivityTimeout: z.number().optional().describe('WebSocket inactivity timeout in seconds, defaults to 180'),
  useSentenceSplitter: z.boolean().optional().describe('Whether to use sentence splitter for text processing, defaults to true'),
}).optional().openapi('VoiceConfig').describe('Voice configuration for TTS');

export type VoiceConfig = z.infer<typeof voiceConfigSchema>;

/**
 * Schema for creating a new persona
 * Required fields: id, name, prompt
 * Optional fields: description, voiceConfig, metadata
 */
export const createPersonaSchema = z.object({
  id: z.string().min(1).optional().describe('Unique identifier for the persona (auto-generated if not provided)'),
  projectId: z.string().min(1).describe('ID of the project this persona belongs to'),
  name: z.string().min(1).describe('Display name of the persona'),
  description: z.string().optional().describe('Detailed description of the persona purpose'),
  prompt: z.string().min(1).describe('Detailed prompt defining the persona\'s characteristics and behavior'),
  ttsProviderId: z.string().optional().describe('ID of the TTS provider (e.g., "eleven-labs")'),
  voiceConfig: voiceConfigSchema.describe('Optional voice configuration settings for TTS'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional persona-specific metadata'),
});

/**
 * Schema for updating a persona
 * Optional fields: name, description, prompt, voiceConfig, metadata, version
 * Version is required for optimistic locking
 */
export const updatePersonaBodySchema = z.object({
  name: z.string().min(1).optional().describe('Updated display name'),
  description: z.string().optional().describe('Updated detailed description of the persona'),
  prompt: z.string().min(1).optional().describe('Updated prompt defining behavior'),
  ttsProviderId: z.string().optional().describe('Updated TTS provider ID'),
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
 * Includes: id, name, description, prompt, voiceConfig, metadata, version, createdAt, updatedAt
 */
export const personaResponseSchema = z.object({
  id: z.string().describe('Unique identifier for the persona'),
  projectId: z.string().describe('ID of the project this persona belongs to'),
  name: z.string().describe('Display name of the persona'),
  description: z.string().nullable().describe('Detailed description of the persona purpose'),
  prompt: z.string().describe('Prompt defining the persona\'s characteristics and behavior'),
  ttsProviderId: z.string().nullable().describe('ID of the TTS provider'),
  voiceConfig: voiceConfigSchema.nullable().describe('Voice configuration settings'),
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

import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { s3StorageSettingsSchema } from '../../services/providers/storage/S3StorageProvider';
import { azureBlobStorageSettingsSchema } from '../../services/providers/storage/AzureBlobStorageProvider';
import { gcsStorageSettingsSchema } from '../../services/providers/storage/GcsStorageProvider';
import { localStorageSettingsSchema } from '../../services/providers/storage/LocalStorageProvider';
import { azureAsrSettingsSchema } from '../../services/providers/asr/AzureAsrProvider';
import { elevenLabsAsrSettingsSchema } from '../../services/providers/asr/ElevenLabsAsrProvider';
import { parameterValueSchema } from '../../types/parameters';
import { deepgramAsrSettingsSchema } from '../../services/providers/asr/DeepgramAsrProvider';
import { assemblyAiAsrSettingsSchema } from '../../services/providers/asr/AssemblyAiAsrProvider';

extendZodWithOpenApi(z);

/**
 * Project request and response schemas
 */

/**
 * Schema for storage provider settings (union of all storage provider settings)
 */
export const storageSettingsSchema = z.union([
  s3StorageSettingsSchema,
  azureBlobStorageSettingsSchema,
  gcsStorageSettingsSchema,
  localStorageSettingsSchema,
]).describe('Storage provider settings');

export type StorageSettings = z.infer<typeof storageSettingsSchema>;

/**
 * Schema for storage configuration
 * Similar to ASR configuration pattern
 */
export const storageConfigSchema = z.object({
  storageProviderId: z.string().optional().describe('ID of the storage provider (e.g., "s3-provider", "azure-blob-provider")'),
  settings: storageSettingsSchema.optional().describe('Storage-specific settings including bucket, prefix, etc.'),
}).openapi('StorageConfig').optional().describe('Storage configuration settings');

export type StorageConfig = z.infer<typeof storageConfigSchema>;

/**
 * Schema for ASR provider settings (union of all ASR provider settings)
 */
export const asrSettingsSchema = z.union([
  azureAsrSettingsSchema,
  elevenLabsAsrSettingsSchema,
  deepgramAsrSettingsSchema,
  assemblyAiAsrSettingsSchema,
]).describe('ASR provider settings');

export const asrConfigSchema = z.object({
  asrProviderId: z.string().optional().describe('ID of the ASR provider (e.g., "azure-speech", "openai-whisper")'),
  settings: asrSettingsSchema.optional().describe('ASR-specific settings including model, language preferences, etc.'),
  unintelligiblePlaceholder: z.string().optional().describe('Placeholder text to use when speech is unintelligible or cannot be transcribed'),
  voiceActivityDetection: z.boolean().optional().describe('Whether to enable voice activity detection to automatically start/stop recording based on speech presence'),
}).openapi('AsrConfig').optional().describe('ASR configuration settings');

export type AsrConfig = z.infer<typeof asrConfigSchema>;
export type AsrSettings = z.infer<typeof asrSettingsSchema>;

/**
 * Schema for creating a new project
 */
export const createProjectSchema = z.object({
  name: z.string().min(1).max(255).describe('The name of the project'),
  description: z.string().optional().describe('A description of the project'),
  asrConfig: asrConfigSchema.optional().describe('Optional ASR configuration settings'),
  acceptVoice: z.boolean().optional().default(true).describe('Whether conversations can accept voice input (requires asrConfig fully populated)'),
  generateVoice: z.boolean().optional().default(true).describe('Whether conversations generate voice responses (requires ttsConfig fully populated in Stages)'),
  storageConfig: storageConfigSchema.optional().describe('Optional storage configuration for conversation artifacts'),
  constants: z.record(z.string(), parameterValueSchema).optional().describe('Key-value store of constants used in templating and conversation logic'),
  metadata: z.record(z.string(), z.any()).optional().describe('Additional metadata for the project'),
});

export type CreateProjectRequest = z.infer<typeof createProjectSchema>;

/**
 * Schema for updating an existing project
 */
export const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional().describe('The updated name of the project'),
  description: z.string().optional().describe('The updated description of the project'),
  asrConfig: asrConfigSchema.describe('Updated ASR configuration settings'),
  acceptVoice: z.boolean().optional().describe('Whether conversations can accept voice input (requires asrConfig fully populated)'),
  generateVoice: z.boolean().optional().describe('Whether conversations generate voice responses (requires ttsConfig fully populated in Stages)'),
  storageConfig: storageConfigSchema.describe('Updated storage configuration settings'),
  constants: z.record(z.string(), parameterValueSchema).optional().describe('Updated constants key-value store'),
  metadata: z.record(z.string(), z.any()).optional().describe('Updated metadata for the project'),
  version: z.number().describe('The current version number for optimistic locking'),
});

export type UpdateProjectRequest = z.infer<typeof updateProjectSchema>;

/**
 * Schema for project response
 */
export const projectResponseSchema = z.object({
  id: z.string().describe('The unique identifier of the project'),
  name: z.string().describe('The name of the project'),
  description: z.string().nullable().describe('A description of the project'),
  asrConfig: asrConfigSchema.nullable().describe('ASR configuration settings'),
  acceptVoice: z.boolean().describe('Whether conversations can accept voice input (requires asrConfig fully populated)'),
  generateVoice: z.boolean().describe('Whether conversations generate voice responses (requires ttsConfig fully populated in Stages)'),
  storageConfig: storageConfigSchema.nullable().describe('Storage configuration for conversation artifacts'),
  constants: z.record(z.string(), parameterValueSchema).nullable().describe('Key-value store of constants used in templating and conversation logic'),
  metadata: z.record(z.string(), z.any()).nullable().describe('Additional metadata for the project'),
  version: z.number().describe('The version number of the project'),
  createdAt: z.coerce.date().describe('The timestamp when the project was created'),
  updatedAt: z.coerce.date().describe('The timestamp when the project was last updated'),
});

export type ProjectResponse = z.infer<typeof projectResponseSchema>;

/**
 * Schema for list of projects
 */
export const projectListResponseSchema = z.object({
  items: z.array(projectResponseSchema).describe('Array of projects'),
  total: z.number().describe('Total number of projects'),
});

export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;

/**
 * Schema for project route parameters
 */
export const projectRouteParamsSchema = z.object({
  id: z.string().describe('The project ID'),
});

export type ProjectRouteParams = z.infer<typeof projectRouteParamsSchema>;

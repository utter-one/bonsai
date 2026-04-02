import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { s3StorageSettingsSchema } from '../../services/providers/storage/S3StorageProvider';
import { azureBlobStorageSettingsSchema } from '../../services/providers/storage/AzureBlobStorageProvider';
import { gcsStorageSettingsSchema } from '../../services/providers/storage/GcsStorageProvider';
import { localStorageSettingsSchema } from '../../services/providers/storage/LocalStorageProvider';
import { azureAsrSettingsSchema } from '../../services/providers/asr/AzureAsrProvider';
import { elevenLabsAsrSettingsSchema } from '../../services/providers/asr/ElevenLabsAsrProvider';
import { parameterValueSchema, fieldDescriptorSchema } from '../../types/parameters';
import { deepgramAsrSettingsSchema } from '../../services/providers/asr/DeepgramAsrProvider';
import { assemblyAiAsrSettingsSchema } from '../../services/providers/asr/AssemblyAiAsrProvider';
import { speechmaticsAsrSettingsSchema } from '../../services/providers/asr/SpeechmaticsAsrProvider';
import { listParamsSchema } from './common';
import { serverVadConfigSchema } from './vad';
import { costManagementConfigSchema } from './costManagement';

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
 * Schema for moderation configuration
 */
export const moderationConfigSchema = z.object({
  enabled: z.boolean().describe('Whether content moderation is enabled for this project'),
  llmProviderId: z.string().describe('ID of the LLM provider used for moderation (must support moderation API, e.g. OpenAI or Mistral)'),
  blockedCategories: z.array(z.string()).optional().describe(
    'List of category names that should cause the input to be blocked. If omitted or empty, any flagged category will block the input. '
    + 'Category names are provider-specific. '
    + 'OpenAI categories: harassment, harassment/threatening, hate, hate/threatening, illicit, illicit/violent, self-harm, self-harm/instructions, self-harm/intent, sexual, sexual/minors, violence, violence/graphic. '
    + 'Mistral categories: sexual, hate_and_discrimination, violence_and_threats, dangerous_and_criminal_content, selfharm, health, financial, law, pii.'
  ),
  mode: z.enum(['strict', 'standard']).optional().describe(
    'Moderation execution mode. '
    + '"strict" (default): moderation runs before all other processing — the turn is held until the moderation result is available. '
    + '"standard": moderation runs after filler generation, in parallel with classification/knowledge retrieval (processTextInput), reducing perceived latency while still blocking flagged input before classification results are acted upon.'  
  ),
}).openapi('ModerationConfig').describe('Content moderation configuration');

export type ModerationConfig = z.infer<typeof moderationConfigSchema>;

/**
 * Schema for sample copy configuration
 */
export const sampleCopyConfigSchema = z.object({
  defaultClassifierId: z.string().optional().describe('ID of the classifier used to evaluate sample copy prompt triggers for all stages in this project. Individual sample copies can override this with classifierOverrideId.'),
}).openapi('SampleCopyConfig').optional().describe('Sample copy configuration settings');

export type SampleCopyConfig = z.infer<typeof sampleCopyConfigSchema>;

/**
 * Schema for ASR provider settings (union of all ASR provider settings)
 */
export const asrSettingsSchema = z.union([
  azureAsrSettingsSchema,
  elevenLabsAsrSettingsSchema,
  deepgramAsrSettingsSchema,
  assemblyAiAsrSettingsSchema,
  speechmaticsAsrSettingsSchema,
]).describe('ASR provider settings');

export const asrConfigSchema = z.object({
  asrProviderId: z.string().optional().describe('ID of the ASR provider (e.g., "azure-speech", "openai-whisper")'),
  settings: asrSettingsSchema.optional().describe('ASR-specific settings including model, language preferences, etc.'),
  unintelligiblePlaceholder: z.string().optional().describe('Placeholder text to use when speech is unintelligible or cannot be transcribed'),
  voiceActivityDetection: z.boolean().optional().describe('Whether to enable voice activity detection to automatically start/stop recording based on speech presence'),
  serverVad: serverVadConfigSchema.optional().describe('Server-side VAD configuration. When set, the server autonomously detects speech boundaries — clients send continuous audio without calling start/end_user_voice_input.'),
}).openapi('AsrConfig').optional().describe('ASR configuration settings');

export type AsrConfig = z.infer<typeof asrConfigSchema>;
export type AsrSettings = z.infer<typeof asrSettingsSchema>;

/**
 * Schema for creating a new project
 */
export const createProjectSchema = z.object({
  name: z.string().min(1).max(255).describe('The name of the project'),
  description: z.string().nullable().optional().describe('A description of the project'),
  asrConfig: asrConfigSchema.optional().describe('Optional ASR configuration settings'),
  acceptVoice: z.boolean().optional().default(true).describe('Whether conversations can accept voice input (requires asrConfig fully populated)'),
  generateVoice: z.boolean().optional().default(true).describe('Whether conversations generate voice responses (requires ttsConfig fully populated in Stages)'),
  storageConfig: storageConfigSchema.optional().describe('Optional storage configuration for conversation artifacts'),
  moderationConfig: moderationConfigSchema.optional().describe('Optional content moderation configuration'),
  costManagementConfig: costManagementConfigSchema.optional().describe('Optional project-level LLM token cost management configuration'),
  constants: z.record(z.string(), parameterValueSchema).optional().describe('Key-value store of constants used in templating and conversation logic'),
  metadata: z.record(z.string(), z.any()).optional().describe('Additional metadata for the project'),
  timezone: z.string().nullable().optional().describe('IANA timezone identifier used as the default for conversations in this project, e.g. Europe/Warsaw or America/New_York. Defaults to UTC when not set.'),
  languageCode: z.string().nullable().optional().describe('ISO language code for the project, e.g. en-US or pl-PL. Used as a hint for language-aware LLM prompts.'),
  autoCreateUsers: z.boolean().optional().default(false).describe('When enabled, users are automatically created on first WebSocket connection if they do not exist, using the provided user ID and an empty profile'),
  userProfileVariableDescriptors: z.array(fieldDescriptorSchema).optional().default([]).describe('Descriptors defining the data schema for user profile variables in this project'),
  defaultGuardrailClassifierId: z.string().nullable().optional().describe('ID of the classifier used to evaluate guardrails for all conversations in this project. When set, all project guardrails are evaluated against this classifier on every user input turn.'),
  sampleCopyConfig: sampleCopyConfigSchema.describe('Sample copy configuration including the default classifier used to evaluate prompt triggers.'),
  conversationTimeoutSeconds: z.number().int().min(0).optional().describe('Timeout in seconds for active conversations with no activity. Set to 0 or omit to disable. Conversations that have been inactive for longer than this value will be automatically aborted.'),
});

export type CreateProjectRequest = z.infer<typeof createProjectSchema>;

/**
 * Schema for updating an existing project.
 * Archive status (archivedAt / archivedBy) is intentionally excluded — use the
 * dedicated archive/unarchive endpoints to change a project's archive state.
 */
export const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional().describe('The updated name of the project'),
  description: z.string().nullable().optional().describe('The updated description of the project'),
  asrConfig: asrConfigSchema.optional().nullable().describe('Updated ASR configuration settings'),
  acceptVoice: z.boolean().optional().describe('Whether conversations can accept voice input (requires asrConfig fully populated)'),
  generateVoice: z.boolean().optional().describe('Whether conversations generate voice responses (requires ttsConfig fully populated in Stages)'),
  storageConfig: storageConfigSchema.optional().nullable().describe('Updated storage configuration settings'),
  moderationConfig: moderationConfigSchema.optional().nullable().describe('Updated content moderation configuration'),
  costManagementConfig: costManagementConfigSchema.optional().nullable().describe('Updated project-level LLM token cost management configuration. Set to null to remove.'),
  constants: z.record(z.string(), parameterValueSchema).optional().describe('Updated constants key-value store'),
  metadata: z.record(z.string(), z.any()).optional().describe('Updated metadata for the project'),
  timezone: z.string().nullable().optional().describe('IANA timezone identifier used as the default for conversations in this project, e.g. Europe/Warsaw or America/New_York. Set to null to clear. Defaults to UTC when not set.'),
  languageCode: z.string().nullable().optional().describe('ISO language code for the project, e.g. en-US or pl-PL. Set to null to clear.'),
  autoCreateUsers: z.boolean().optional().describe('When enabled, users are automatically created on first WebSocket connection if they do not exist, using the provided user ID and an empty profile'),
  userProfileVariableDescriptors: z.array(fieldDescriptorSchema).optional().describe('Updated descriptors defining the data schema for user profile variables in this project'),
  defaultGuardrailClassifierId: z.string().nullable().optional().describe('Updated ID of the classifier used to evaluate guardrails. Set to null to disable guardrail classification.'),
  sampleCopyConfig: sampleCopyConfigSchema.nullable().describe('Updated sample copy configuration. Set to null to clear.'),
  conversationTimeoutSeconds: z.number().int().min(0).nullable().optional().describe('Timeout in seconds for active conversations with no activity. Set to 0 or null to disable. Conversations that have been inactive for longer than this value will be automatically aborted.'),
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
  moderationConfig: moderationConfigSchema.nullable().describe('Content moderation configuration'),
  costManagementConfig: costManagementConfigSchema.nullable().describe('Project-level LLM token cost management configuration'),
  constants: z.record(z.string(), parameterValueSchema).nullable().describe('Key-value store of constants used in templating and conversation logic'),
  metadata: z.record(z.string(), z.any()).nullable().describe('Additional metadata for the project'),
  timezone: z.string().nullable().describe('IANA timezone identifier used as the default for conversations in this project, e.g. Europe/Warsaw or America/New_York. Null means UTC.'),
  languageCode: z.string().nullable().describe('ISO language code for the project, e.g. en-US or pl-PL. Null if not set.'),
  autoCreateUsers: z.boolean().describe('When enabled, users are automatically created on first WebSocket connection if they do not exist, using the provided user ID and an empty profile'),
  userProfileVariableDescriptors: z.array(fieldDescriptorSchema).describe('Descriptors defining the data schema for user profile variables in this project'),
  defaultGuardrailClassifierId: z.string().nullable().describe('ID of the classifier used to evaluate guardrails for all conversations in this project'),
  sampleCopyConfig: sampleCopyConfigSchema.nullable().describe('Sample copy configuration including the default classifier used to evaluate prompt triggers.'),
  conversationTimeoutSeconds: z.number().int().nullable().describe('Timeout in seconds for active conversations with no activity. Null or 0 means no timeout.'),
  version: z.number().describe('The version number of the project'),
  createdAt: z.coerce.date().describe('The timestamp when the project was created'),
  updatedAt: z.coerce.date().describe('The timestamp when the project was last updated'),
  archivedAt: z.coerce.date().nullable().describe('The timestamp when the project was archived, or null if the project is not archived'),
  archivedBy: z.string().nullable().describe('The ID of the operator who archived the project, or null if the project is not archived'),
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

/**
 * Schema for archive/unarchive project request body
 */
export const archiveProjectSchema = z.object({
  version: z.number().int().describe('The current version number for optimistic locking'),
});

export type ArchiveProjectRequest = z.infer<typeof archiveProjectSchema>;

/**
 * Schema for listing projects with an optional archived filter
 */
export const listProjectsQuerySchema = listParamsSchema.extend({
  archived: z.enum(['true', 'false']).transform(v => v === 'true').optional().describe('When true, returns only archived projects. When omitted or false, returns only active (non-archived) projects.'),
});

export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

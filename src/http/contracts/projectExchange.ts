import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { llmSettingsSchema, ttsSettingsSchema } from './common';
import { asrSettingsSchema } from './project';
import { effectSchema, stageActionSchema, stageActionParameterSchema, toolParameterSchema } from '../../types/actions';
import { fieldDescriptorSchema, parameterValueSchema } from '../../types/parameters';

extendZodWithOpenApi(z);

// ====================
// Provider Hint
// ====================

/**
 * A provider-agnostic reference that identifies the *kind* of provider needed,
 * without including credentials or a specific instance UUID.
 *
 * On import, the receiving system uses `type` + `apiType` to locate a matching
 * local provider. If `preferredModel` is set it serves as a documentation-level
 * hint for operators but is never enforced programmatically.
 */
export const providerHintSchema = z.object({
  type: z.enum(['llm', 'tts', 'asr', 'storage', 'embeddings']).describe('Category of the provider (llm, tts, asr, storage, embeddings)'),
  apiType: z.string().describe('Provider implementation identifier, e.g. "openai", "anthropic", "elevenlabs", "azure", "deepgram"'),
  preferredModel: z.string().optional().describe('Optional: model name that was in use at export time, carried as a hint for the operator configuring the target instance'),
}).openapi('ProviderHint').describe('Provider-agnostic reference that identifies the kind of provider needed without carrying credentials or a specific UUID');

/** Provider-agnostic reference identifying a provider type and implementation */
export type ProviderHint = z.infer<typeof providerHintSchema>;

// ====================
// Config exchange sub-schemas
// (mirror project config schemas but replace *ProviderId with *Hint)
// ====================

/**
 * ASR configuration with a provider hint instead of a provider UUID.
 */
export const asrConfigExchangeV1Schema = z.object({
  asrHint: providerHintSchema.optional().describe('Provider hint identifying the ASR provider type used at export time'),
  settings: asrSettingsSchema.optional().describe('ASR-specific settings including model, language preferences, etc.'),
  unintelligiblePlaceholder: z.string().optional().describe('Placeholder text to use when speech is unintelligible or cannot be transcribed'),
  voiceActivityDetection: z.boolean().optional().describe('Whether to enable voice activity detection'),
}).openapi('AsrConfigExchangeV1').optional().describe('ASR configuration with provider hint instead of provider UUID');

/** ASR config for the exchange format */
export type AsrConfigExchangeV1 = z.infer<typeof asrConfigExchangeV1Schema>;

/**
 * Storage configuration with a provider hint instead of a provider UUID.
 */
export const storageConfigExchangeV1Schema = z.object({
  storageHint: providerHintSchema.optional().describe('Provider hint identifying the storage provider type used at export time'),
  settings: z.record(z.string(), z.unknown()).optional().describe('Storage-specific settings including bucket, prefix, etc.'),
}).openapi('StorageConfigExchangeV1').optional().describe('Storage configuration with provider hint instead of provider UUID');

/** Storage config for the exchange format */
export type StorageConfigExchangeV1 = z.infer<typeof storageConfigExchangeV1Schema>;

/**
 * Moderation configuration with a provider hint instead of a provider UUID.
 */
export const moderationConfigExchangeV1Schema = z.object({
  enabled: z.boolean().describe('Whether content moderation is enabled for this project'),
  llmHint: providerHintSchema.describe('Provider hint identifying the LLM provider used for moderation'),
  blockedCategories: z.array(z.string()).optional().describe('List of category names that should cause the input to be blocked'),
}).openapi('ModerationConfigExchangeV1').describe('Content moderation configuration with provider hint instead of provider UUID');

/** Moderation config for the exchange format */
export type ModerationConfigExchangeV1 = z.infer<typeof moderationConfigExchangeV1Schema>;

/**
 * Filler settings with a provider hint instead of a provider UUID.
 */
export const fillerSettingsExchangeV1Schema = z.object({
  llmHint: providerHintSchema.describe('Provider hint identifying the LLM provider used to generate filler sentences'),
  llmSettings: llmSettingsSchema.describe('LLM provider-specific settings for filler generation'),
  prompt: z.string().min(1).describe('Prompt instructing the LLM to produce a short neutral filler sentence'),
}).openapi('FillerSettingsExchangeV1').describe('Filler response settings with provider hint instead of provider UUID');

/** Filler settings for the exchange format */
export type FillerSettingsExchangeV1 = z.infer<typeof fillerSettingsExchangeV1Schema>;

// ====================
// Entity exchange schemas
// (strip version/createdAt/updatedAt/archivedAt/archivedBy; keep id for cross-refs)
// ====================

/**
 * Project entity in the exchange format.
 * Contains all project configuration fields with provider references replaced by hints.
 * The `id` is preserved as a local cross-reference used by child entities; it is
 * remapped to a fresh UUID on import.
 */
export const projectExchangeV1Schema = z.object({
  id: z.string().describe('Local document ID used as a cross-reference by child entities; remapped to a fresh UUID on import'),
  name: z.string().min(1).describe('The name of the project'),
  description: z.string().nullable().optional().describe('A description of the project'),
  asrConfig: asrConfigExchangeV1Schema.describe('ASR configuration with provider hint'),
  acceptVoice: z.boolean().optional().describe('Whether conversations can accept voice input'),
  generateVoice: z.boolean().optional().describe('Whether conversations generate voice responses'),
  storageConfig: storageConfigExchangeV1Schema.describe('Storage configuration with provider hint'),
  moderationConfig: moderationConfigExchangeV1Schema.nullable().optional().describe('Content moderation configuration with provider hint'),
  constants: z.record(z.string(), parameterValueSchema).nullable().optional().describe('Key-value store of constants used in templating and conversation logic'),
  metadata: z.record(z.string(), z.unknown()).nullable().optional().describe('Additional metadata for the project'),
  timezone: z.string().nullable().optional().describe('IANA timezone identifier, e.g. Europe/Warsaw or America/New_York'),
  autoCreateUsers: z.boolean().optional().describe('When enabled, users are automatically created on first WebSocket connection'),
  userProfileVariableDescriptors: z.array(fieldDescriptorSchema).optional().describe('Descriptors defining the data schema for user profile variables'),
  defaultGuardrailClassifierId: z.string().nullable().optional().describe('Local document ID of the classifier used to evaluate guardrails; remapped on import'),
  conversationTimeoutSeconds: z.number().int().min(0).nullable().optional().describe('Timeout in seconds for active conversations with no activity'),
}).openapi('ProjectExchangeV1').describe('Project entity in the exchange format');

/** Project entity in the exchange format */
export type ProjectExchangeV1 = z.infer<typeof projectExchangeV1Schema>;

/**
 * Agent entity in the exchange format.
 * The TTS provider reference is replaced by a hint.
 */
export const agentExchangeV1Schema = z.object({
  id: z.string().describe('Local document ID; remapped to a fresh UUID on import'),
  name: z.string().describe('Display name of the agent'),
  description: z.string().nullable().optional().describe('Detailed description of the agent purpose'),
  prompt: z.string().describe('Prompt defining the agent\'s characteristics and behavior'),
  ttsHint: providerHintSchema.nullable().optional().describe('Provider hint identifying the TTS provider used at export time'),
  ttsSettings: ttsSettingsSchema.describe('TTS provider-specific settings'),
  tags: z.array(z.string()).optional().describe('Tags for categorizing and filtering this agent'),
  metadata: z.record(z.string(), z.unknown()).nullable().optional().describe('Additional agent-specific metadata'),
  fillerSettings: fillerSettingsExchangeV1Schema.nullable().optional().describe('Filler response settings with provider hint'),
}).openapi('AgentExchangeV1').describe('Agent entity in the exchange format');

/** Agent entity in the exchange format */
export type AgentExchangeV1 = z.infer<typeof agentExchangeV1Schema>;

/**
 * Stage entity in the exchange format.
 * The LLM provider reference is replaced by a hint; agent/classifier cross-references
 * remain as local document IDs and are remapped on import.
 */
export const stageExchangeV1Schema = z.object({
  id: z.string().describe('Local document ID; remapped to a fresh UUID on import'),
  name: z.string().describe('Display name of the stage'),
  description: z.string().nullable().optional().describe('Detailed description of the stage purpose'),
  prompt: z.string().describe('System prompt defining the stage behavior'),
  llmHint: providerHintSchema.nullable().optional().describe('Provider hint identifying the LLM provider used at export time'),
  llmSettings: llmSettingsSchema.describe('LLM provider-specific settings for this stage'),
  agentId: z.string().describe('Local document ID of the associated agent; remapped on import'),
  enterBehavior: z.enum(['generate_response', 'await_user_input']).optional().describe('What happens when entering this stage'),
  useKnowledge: z.boolean().optional().describe('Whether knowledge base is enabled in this stage'),
  knowledgeTags: z.array(z.string()).optional().describe('Knowledge tags included in this stage'),
  useGlobalActions: z.boolean().optional().describe('Whether global actions are enabled in this stage'),
  globalActions: z.array(z.string()).optional().describe('Local document IDs of global actions available in this stage; remapped on import'),
  variableDescriptors: z.array(fieldDescriptorSchema).optional().describe('Variable descriptor definitions for this stage'),
  actions: z.record(z.string(), stageActionSchema).optional().describe('Action definitions for this stage'),
  defaultClassifierId: z.string().nullable().optional().describe('Local document ID of the default classifier; remapped on import'),
  transformerIds: z.array(z.string()).optional().describe('Local document IDs of context transformers; remapped on import'),
  tags: z.array(z.string()).optional().describe('Tags for categorizing and filtering this stage'),
  metadata: z.record(z.string(), z.unknown()).nullable().optional().describe('Additional stage-specific metadata'),
}).openapi('StageExchangeV1').describe('Stage entity in the exchange format');

/** Stage entity in the exchange format */
export type StageExchangeV1 = z.infer<typeof stageExchangeV1Schema>;

/**
 * Classifier entity in the exchange format.
 * The LLM provider reference is replaced by a hint.
 */
export const classifierExchangeV1Schema = z.object({
  id: z.string().describe('Local document ID; remapped to a fresh UUID on import'),
  name: z.string().describe('Display name of the classifier'),
  description: z.string().nullable().optional().describe('Detailed description of the classifier'),
  prompt: z.string().describe('Prompt defining the classification logic'),
  llmHint: providerHintSchema.nullable().optional().describe('Provider hint identifying the LLM provider used at export time'),
  llmSettings: llmSettingsSchema.describe('LLM provider-specific settings for this classifier'),
  tags: z.array(z.string()).optional().describe('Tags for categorizing and filtering this classifier'),
  metadata: z.record(z.string(), z.unknown()).nullable().optional().describe('Additional classifier-specific metadata'),
}).openapi('ClassifierExchangeV1').describe('Classifier entity in the exchange format');

/** Classifier entity in the exchange format */
export type ClassifierExchangeV1 = z.infer<typeof classifierExchangeV1Schema>;

/**
 * Context transformer entity in the exchange format.
 * The LLM provider reference is replaced by a hint.
 */
export const contextTransformerExchangeV1Schema = z.object({
  id: z.string().describe('Local document ID; remapped to a fresh UUID on import'),
  name: z.string().describe('Display name of the context transformer'),
  description: z.string().nullable().optional().describe('Detailed description of the transformer'),
  prompt: z.string().describe('Prompt defining the transformation logic'),
  contextFields: z.array(z.string()).nullable().optional().describe('Context field names to be transformed'),
  llmHint: providerHintSchema.nullable().optional().describe('Provider hint identifying the LLM provider used at export time'),
  llmSettings: llmSettingsSchema.describe('LLM provider-specific settings for this transformer'),
  tags: z.array(z.string()).optional().describe('Tags for categorizing and filtering this context transformer'),
  metadata: z.record(z.string(), z.unknown()).nullable().optional().describe('Additional transformer-specific metadata'),
}).openapi('ContextTransformerExchangeV1').describe('Context transformer entity in the exchange format');

/** Context transformer entity in the exchange format */
export type ContextTransformerExchangeV1 = z.infer<typeof contextTransformerExchangeV1Schema>;

/**
 * Tool entity in the exchange format.
 * The LLM provider reference is replaced by a hint.
 */
export const toolExchangeV1Schema = z.object({
  id: z.string().describe('Local document ID; remapped to a fresh UUID on import'),
  name: z.string().describe('Display name of the tool'),
  description: z.string().nullable().optional().describe('Detailed description of the tool'),
  prompt: z.string().describe('Handlebars template for tool invocation'),
  llmHint: providerHintSchema.nullable().optional().describe('Provider hint identifying the LLM provider used at export time'),
  llmSettings: llmSettingsSchema.describe('LLM provider-specific settings for this tool'),
  inputType: z.enum(['text', 'image', 'multi-modal']).describe('Expected input format for the tool'),
  outputType: z.enum(['text', 'image', 'multi-modal']).describe('Expected output format from the tool'),
  parameters: z.array(toolParameterSchema).optional().describe('Parameters that this tool expects to receive'),
  tags: z.array(z.string()).optional().describe('Tags for categorizing and filtering this tool'),
  metadata: z.record(z.string(), z.unknown()).nullable().optional().describe('Additional tool-specific metadata'),
}).openapi('ToolExchangeV1').describe('Tool entity in the exchange format');

/** Tool entity in the exchange format */
export type ToolExchangeV1 = z.infer<typeof toolExchangeV1Schema>;

/**
 * Global action entity in the exchange format.
 * No provider references — all fields are portable as-is.
 */
export const globalActionExchangeV1Schema = z.object({
  id: z.string().describe('Local document ID; remapped to a fresh UUID on import'),
  name: z.string().describe('Display name of the global action'),
  condition: z.string().nullable().optional().describe('Optional condition expression for action activation'),
  triggerOnUserInput: z.boolean().optional().describe('Whether this action is triggered on user input'),
  triggerOnClientCommand: z.boolean().optional().describe('Whether this action is triggered on client commands'),
  classificationTrigger: z.string().nullable().optional().describe('Classification label that triggers this action'),
  overrideClassifierId: z.string().nullable().optional().describe('Local document ID of an override classifier; remapped on import'),
  parameters: z.array(stageActionParameterSchema).optional().describe('Parameters to extract from user input'),
  effects: z.array(effectSchema).optional().describe('Effects to execute when action is triggered'),
  examples: z.array(z.string()).nullable().optional().describe('Example phrases that trigger this action'),
  tags: z.array(z.string()).optional().describe('Tags for categorizing and filtering this global action'),
  metadata: z.record(z.string(), z.unknown()).nullable().optional().describe('Additional action-specific metadata'),
}).openapi('GlobalActionExchangeV1').describe('Global action entity in the exchange format');

/** Global action entity in the exchange format */
export type GlobalActionExchangeV1 = z.infer<typeof globalActionExchangeV1Schema>;

/**
 * Guardrail entity in the exchange format.
 * No provider references — all fields are portable as-is.
 */
export const guardrailExchangeV1Schema = z.object({
  id: z.string().describe('Local document ID; remapped to a fresh UUID on import'),
  name: z.string().describe('Display name of the guardrail'),
  condition: z.string().nullable().optional().describe('Condition expression for guardrail activation'),
  classificationTrigger: z.string().nullable().optional().describe('Classification label that triggers this guardrail'),
  effects: z.array(effectSchema).optional().describe('Effects to execute when the guardrail is triggered'),
  examples: z.array(z.string()).nullable().optional().describe('Example phrases that trigger this guardrail'),
  tags: z.array(z.string()).optional().describe('Tags for categorizing and filtering this guardrail'),
  metadata: z.record(z.string(), z.unknown()).nullable().optional().describe('Additional guardrail-specific metadata'),
}).openapi('GuardrailExchangeV1').describe('Guardrail entity in the exchange format');

/** Guardrail entity in the exchange format */
export type GuardrailExchangeV1 = z.infer<typeof guardrailExchangeV1Schema>;

/**
 * Knowledge category entity in the exchange format.
 * The `id` is preserved as a local cross-reference for knowledge items.
 */
export const knowledgeCategoryExchangeV1Schema = z.object({
  id: z.string().describe('Local document ID used by knowledge items; remapped to a fresh UUID on import'),
  name: z.string().describe('Name of the knowledge category'),
  promptTrigger: z.string().describe('Trigger phrase that activates this category in conversations'),
  tags: z.array(z.string()).optional().describe('Array of knowledge tags this category belongs to'),
  order: z.number().int().min(0).optional().describe('Display order for the category'),
}).openapi('KnowledgeCategoryExchangeV1').describe('Knowledge category entity in the exchange format');

/** Knowledge category entity in the exchange format */
export type KnowledgeCategoryExchangeV1 = z.infer<typeof knowledgeCategoryExchangeV1Schema>;

/**
 * Knowledge item entity in the exchange format.
 * The `categoryId` is a local document ID pointing to the parent category.
 */
export const knowledgeItemExchangeV1Schema = z.object({
  id: z.string().describe('Local document ID; remapped to a fresh UUID on import'),
  categoryId: z.string().describe('Local document ID of the parent knowledge category; remapped on import'),
  question: z.string().describe('Question text for this knowledge item'),
  answer: z.string().describe('Answer text for this knowledge item'),
  order: z.number().int().min(0).optional().describe('Display order within the category'),
}).openapi('KnowledgeItemExchangeV1').describe('Knowledge item entity in the exchange format');

/** Knowledge item entity in the exchange format */
export type KnowledgeItemExchangeV1 = z.infer<typeof knowledgeItemExchangeV1Schema>;

// ====================
// Import result
// ====================

/**
 * A single entity field that references a provider hint.
 */
export const providerHintResolutionTargetSchema = z.object({
  entityType: z.enum(['project', 'agent', 'stage', 'classifier', 'contextTransformer', 'tool']).describe('Type of entity that references this provider hint'),
  entityId: z.string().describe('New ID assigned to the entity on import'),
  entityName: z.string().describe('Display name of the entity'),
  field: z.string().describe('Field that holds the provider reference, e.g. "ttsProviderId", "llmProviderId", "asrConfig.asrProviderId", "fillerSettings.llmProviderId"'),
}).openapi('ProviderHintResolutionTarget').describe('Entity field that references a particular provider hint');

/** Entity field that references a provider hint */
export type ProviderHintResolutionTarget = z.infer<typeof providerHintResolutionTargetSchema>;

/**
 * Resolution report entry for a single provider hint encountered during import.
 * Describes what the hint asked for, whether a matching local provider was found,
 * and which entity fields are affected.
 */
export const providerHintResolutionSchema = z.object({
  hint: providerHintSchema.describe('The provider hint as it appeared in the bundle'),
  resolvedProviderId: z.string().nullable().describe('Local provider ID the hint resolved to, or null when no matching provider was found'),
  resolved: z.boolean().describe('True when a matching local provider was found; false means the corresponding provider field was set to null after import'),
  targets: z.array(providerHintResolutionTargetSchema).describe('Entity fields that reference this hint — shows exactly which entities were affected and which field was mapped (or left null)'),
}).openapi('ProviderHintResolution').describe('Resolution report for a single provider hint encountered during import');

/** Resolution report entry for a single provider hint */
export type ProviderHintResolution = z.infer<typeof providerHintResolutionSchema>;

/**
 * Summary returned after a successful project import.
 */
export const projectExchangeImportResultSchema = z.object({
  projectId: z.string().describe('Newly assigned ID of the imported project'),
  counts: z.object({
    agents: z.number().int().describe('Number of agents imported'),
    stages: z.number().int().describe('Number of stages imported'),
    classifiers: z.number().int().describe('Number of classifiers imported'),
    contextTransformers: z.number().int().describe('Number of context transformers imported'),
    tools: z.number().int().describe('Number of tools imported'),
    globalActions: z.number().int().describe('Number of global actions imported'),
    guardrails: z.number().int().describe('Number of guardrails imported'),
    knowledgeCategories: z.number().int().describe('Number of knowledge categories imported'),
    knowledgeItems: z.number().int().describe('Number of knowledge items imported'),
  }).describe('Count of each entity type that was created'),
  providerResolution: z.array(providerHintResolutionSchema).describe(
    'Resolution report for every unique provider hint found in the bundle. '
    + 'Each entry shows what the hint requested and which local provider it mapped to. '
    + 'Entries with resolved=false indicate provider fields that were set to null — '
    + 'the affected entities will need their provider re-configured manually.',
  ),
}).openapi('ProjectExchangeImportResult').describe('Summary of a completed project import operation');

/** Summary returned after a successful project import */
export type ProjectExchangeImportResult = z.infer<typeof projectExchangeImportResultSchema>;

// ====================
// Top-level bundle (versioned)
// ====================

/**
 * Version 1 of the project exchange bundle.
 * Contains a complete, self-consistent snapshot of one project and all its
 * child entities. Provider references are replaced by provider hints so the
 * bundle is deployable to any environment that has compatible providers.
 *
 * ID cross-references within the bundle use the original UUIDs as local
 * document IDs — these are remapped to fresh UUIDs on import so repeated
 * imports never collide with existing data.
 */
export const projectExchangeBundleV1Schema = z.object({
  formatVersion: z.literal(1).describe('Exchange format version. Always 1 for this schema revision.'),
  exportedAt: z.string().datetime().describe('ISO 8601 timestamp of when this bundle was produced'),
  project: projectExchangeV1Schema.describe('Project configuration and settings'),
  agents: z.array(agentExchangeV1Schema).describe('Agent entities belonging to this project'),
  stages: z.array(stageExchangeV1Schema).describe('Stage entities belonging to this project'),
  classifiers: z.array(classifierExchangeV1Schema).describe('Classifier entities belonging to this project'),
  contextTransformers: z.array(contextTransformerExchangeV1Schema).describe('Context transformer entities belonging to this project'),
  tools: z.array(toolExchangeV1Schema).describe('Tool entities belonging to this project'),
  globalActions: z.array(globalActionExchangeV1Schema).describe('Global action entities belonging to this project'),
  guardrails: z.array(guardrailExchangeV1Schema).describe('Guardrail entities belonging to this project'),
  knowledgeCategories: z.array(knowledgeCategoryExchangeV1Schema).describe('Knowledge category entities belonging to this project'),
  knowledgeItems: z.array(knowledgeItemExchangeV1Schema).describe('Knowledge item entities belonging to this project'),
}).openapi('ProjectExchangeBundleV1').describe('Version 1 project exchange bundle — self-contained, provider-agnostic snapshot of a complete project');

/** Version 1 of the project exchange bundle */
export type ProjectExchangeBundleV1 = z.infer<typeof projectExchangeBundleV1Schema>;

/**
 * Versioned project exchange bundle.
 * A discriminated union keyed on `formatVersion`; new versions can be added
 * by appending additional schemas to the union without breaking existing parsers.
 */
export const projectExchangeBundleSchema = z.discriminatedUnion('formatVersion', [
  projectExchangeBundleV1Schema,
]).describe('Versioned project exchange bundle');

/** Versioned project exchange bundle (union of all supported versions) */
export type ProjectExchangeBundle = z.infer<typeof projectExchangeBundleSchema>;

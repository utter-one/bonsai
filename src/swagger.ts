import 'reflect-metadata';
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { createOperatorSchema, updateOperatorBodySchema, deleteOperatorBodySchema, operatorResponseSchema, operatorListResponseSchema, updateProfileSchema, profileResponseSchema } from './http/contracts/operator';
import { createUserSchema, updateUserBodySchema, userResponseSchema, userListResponseSchema } from './http/contracts/user';
import { createProjectSchema, updateProjectSchema, projectResponseSchema, projectListResponseSchema, archiveProjectSchema, listProjectsQuerySchema, moderationConfigSchema } from './http/contracts/project';
import { createAgentSchema, updateAgentBodySchema, deleteAgentBodySchema, agentResponseSchema, agentListResponseSchema, fillerSettingsSchema } from './http/contracts/agent';
import { loginSchema, refreshTokenSchema, loginResponseSchema, refreshTokenResponseSchema } from './http/contracts/auth';
import { initialOperatorSetupSchema, setupStatusResponseSchema, initialOperatorSetupResponseSchema } from './http/contracts/setup';
import { createKnowledgeCategorySchema, updateKnowledgeCategoryBodySchema, deleteKnowledgeCategoryBodySchema, knowledgeCategoryResponseSchema, knowledgeCategoryListResponseSchema, createKnowledgeItemSchema, updateKnowledgeItemBodySchema, deleteKnowledgeItemBodySchema, knowledgeItemResponseSchema, knowledgeItemListResponseSchema } from './http/contracts/knowledge';
import { createIssueSchema, updateIssueBodySchema, issueResponseSchema, issueListResponseSchema } from './http/contracts/issue';
import { conversationResponseSchema, conversationListResponseSchema, conversationEventResponseSchema, conversationEventListResponseSchema } from './http/contracts/conversation';
import { createStageSchema, updateStageBodySchema, deleteStageBodySchema, stageResponseSchema, stageListResponseSchema } from './http/contracts/stage';
import { createClassifierSchema, updateClassifierBodySchema, deleteClassifierBodySchema, classifierResponseSchema, classifierListResponseSchema } from './http/contracts/classifier';
import { createContextTransformerSchema, updateContextTransformerBodySchema, deleteContextTransformerBodySchema, contextTransformerResponseSchema, contextTransformerListResponseSchema } from './http/contracts/contextTransformer';
import { createToolSchema, createSmartFunctionToolSchema, createWebhookToolSchema, createScriptToolSchema, updateToolBodySchema, deleteToolBodySchema, toolResponseSchema, toolListResponseSchema, toolTypeSchema } from './http/contracts/tool';
import { createGlobalActionSchema, updateGlobalActionBodySchema, deleteGlobalActionBodySchema, globalActionResponseSchema, globalActionListResponseSchema, globalActionRouteParamsSchema } from './http/contracts/globalAction';
import { createEnvironmentSchema, updateEnvironmentBodySchema, deleteEnvironmentBodySchema, environmentResponseSchema, environmentListResponseSchema, environmentRouteParamsSchema } from './http/contracts/environment';
import { createGuardrailSchema, updateGuardrailBodySchema, deleteGuardrailBodySchema, guardrailResponseSchema, guardrailListResponseSchema, cloneGuardrailSchema } from './http/contracts/guardrail';
import { createProviderSchema, updateProviderBodySchema, deleteProviderBodySchema, providerResponseSchema, providerListResponseSchema, providerModelsResponseSchema } from './http/contracts/provider';
import { providerCatalogSchema, asrProvidersResponseSchema, ttsProvidersResponseSchema, llmProvidersResponseSchema, asrProviderInfoSchema, ttsProviderInfoSchema, llmProviderInfoSchema, asrModelInfoSchema, llmModelInfoSchema, voiceInfoSchema, languageInfoSchema, ttsModelInfoSchema, moderationProvidersResponseSchema, moderationProviderInfoSchema, moderationModelInfoSchema, moderationCategoryInfoSchema } from './http/contracts/providerCatalog';
import { auditLogResponseSchema, auditLogListResponseSchema } from './http/contracts/audit';
import { latencyMetricSchema, percentileSetSchema, latencyTrendPointSchema } from './http/contracts/analytics';
import { createApiKeySchema, updateApiKeySchema, deleteApiKeyBodySchema, apiKeyResponseSchema, apiKeyListResponseSchema } from './http/contracts/apiKey';
import { listParamsSchema, llmSettingsSchema } from './http/contracts/common';
import { asrConfigSchema } from './http/contracts/project';
import { effectSchema, endConversationEffectSchema, abortConversationEffectSchema, goToStageEffectSchema, runScriptEffectSchema, modifyUserInputEffectSchema, modifyVariablesEffectSchema, modifyUserProfileEffectSchema, variableOperationSchema, userProfileOperationSchema, callToolEffectSchema, callWebhookEffectSchema, generateResponseEffectSchema, stageActionSchema, stageActionParameterSchema, toolParameterSchema } from './types/actions';
import { fieldDescriptorSchema } from './types/parameters';
import { openAILlmSettingsSchema } from './services/providers/llm/OpenAILlmProvider';
import { openAILegacyLlmSettingsSchema } from './services/providers/llm/OpenAILegacyLlmProvider';
import { anthropicLlmSettingsSchema } from './services/providers/llm/AnthropicLlmProvider';
import { geminiLlmSettingsSchema } from './services/providers/llm/GeminiLlmProvider';
import { groqLlmSettingsSchema } from './services/providers/llm/GroqLlmProvider';
import { mistralLlmSettingsSchema } from './services/providers/llm/MistralLlmProvider';
import { deepSeekLlmSettingsSchema } from './services/providers/llm/DeepSeekLlmProvider';
import { openRouterLlmSettingsSchema } from './services/providers/llm/OpenRouterLlmProvider';
import { togetherAILlmSettingsSchema } from './services/providers/llm/TogetherAILlmProvider';
import { fireworksAILlmSettingsSchema } from './services/providers/llm/FireworksAILlmProvider';
import { perplexityLlmSettingsSchema } from './services/providers/llm/PerplexityLlmProvider';
import { cohereLlmSettingsSchema } from './services/providers/llm/CohereLlmProvider';
import { xAILlmSettingsSchema } from './services/providers/llm/XAILlmProvider';
import { elevenLabsTtsSettingsSchema } from './services/providers/tts/ElevenLabsTtsProvider';
import { openAiTtsSettingsSchema } from './services/providers/tts/OpenAiTtsProvider';
import { deepgramTtsSettingsSchema } from './services/providers/tts/DeepgramTtsProvider';
import { azureTtsSettingsSchema } from './services/providers/tts/AzureTtsProvider';
import { s3StorageProviderConfigSchema, s3StorageSettingsSchema } from './services/providers/storage/S3StorageProvider';
import { azureBlobStorageProviderConfigSchema, azureBlobStorageSettingsSchema } from './services/providers/storage/AzureBlobStorageProvider';
import { gcsStorageProviderConfigSchema, gcsStorageSettingsSchema } from './services/providers/storage/GcsStorageProvider';
import { localStorageProviderConfigSchema, localStorageSettingsSchema } from './services/providers/storage/LocalStorageProvider';
import { cartesiaTtsSettingsSchema } from './services/providers/tts/CartesiaTtsProvider';
import { amazonPollyTtsSettingsSchema } from './services/providers/tts/AmazonPollyTtsProvider';
import { azureAsrSettingsSchema } from './services/providers/asr/AzureAsrProvider';
import { elevenLabsAsrSettingsSchema } from './services/providers/asr/ElevenLabsAsrProvider';
import { deepgramAsrSettingsSchema } from './services/providers/asr/DeepgramAsrProvider';
import { assemblyAiAsrSettingsSchema } from './services/providers/asr/AssemblyAiAsrProvider';
import { speechmaticsAsrSettingsSchema } from './services/providers/asr/SpeechmaticsAsrProvider';
import { OperatorController } from './http/controllers/OperatorController';
import { UserController } from './http/controllers/UserController';
import { ProjectController } from './http/controllers/ProjectController';
import { AgentController } from './http/controllers/AgentController';
import { AuthController } from './http/controllers/AuthController';
import { SetupController } from './http/controllers/SetupController';
import { KnowledgeController } from './http/controllers/KnowledgeController';
import { IssueController } from './http/controllers/IssueController';
import { ConversationController } from './http/controllers/ConversationController';
import { StageController } from './http/controllers/StageController';
import { ClassifierController } from './http/controllers/ClassifierController';
import { ContextTransformerController } from './http/controllers/ContextTransformerController';
import { ToolController } from './http/controllers/ToolController';
import { GlobalActionController } from './http/controllers/GlobalActionController';
import { GuardrailController } from './http/controllers/GuardrailController';
import { EnvironmentController } from './http/controllers/EnvironmentController';
import { ProviderController } from './http/controllers/ProviderController';
import { ProviderCatalogController } from './http/controllers/ProviderCatalogController';
import { AuditController } from './http/controllers/AuditController';
import { AnalyticsController } from './http/controllers/AnalyticsController';
import { ApiKeyController } from './http/controllers/ApiKeyController';
import { VersionController } from './http/controllers/VersionController';
import { versionResponseSchema } from './http/contracts/version';
import { MigrationController } from './http/controllers/MigrationController';
import { exportBundleSchema, migrationResultSchema, migrationJobSchema, migrationEntityCountSchema, migrationPreviewSchema, entityStubSchema } from './http/contracts/migration';
import { ProjectExchangeController } from './http/controllers/ProjectExchangeController';
import { providerHintSchema, providerHintResolutionTargetSchema, providerHintResolutionSchema, asrConfigExchangeV1Schema, storageConfigExchangeV1Schema, moderationConfigExchangeV1Schema, fillerSettingsExchangeV1Schema, projectExchangeV1Schema, agentExchangeV1Schema, stageExchangeV1Schema, classifierExchangeV1Schema, contextTransformerExchangeV1Schema, toolExchangeV1Schema, globalActionExchangeV1Schema, guardrailExchangeV1Schema, knowledgeCategoryExchangeV1Schema, knowledgeItemExchangeV1Schema, projectExchangeBundleV1Schema, projectExchangeImportResultSchema } from './http/contracts/projectExchange';

extendZodWithOpenApi(z);

let cachedOpenAPISpec: any = null;

/**
 * Generate (or return cached) OpenAPI specification from Zod schemas and controller decorators.
 * The spec is built once per process lifetime and cached in module scope.
 */
export function getOpenAPISpec(): any {
  if (cachedOpenAPISpec) return cachedOpenAPISpec;

  const registry = new OpenAPIRegistry();

  // Register common/reusable sub-schemas first (these will be referenced by other schemas)
  // This prevents them from being inlined and makes them reusable across the API

  // Common schemas
  registry.register('ListParams', listParamsSchema);
  registry.register('ArchiveProject', archiveProjectSchema);
  registry.register('ListProjectsQuery', listProjectsQuerySchema);

  // LLM settings schemas (provider-specific)
  registry.register('OpenAILlmSettings', openAILlmSettingsSchema);
  registry.register('OpenAILegacyLlmSettings', openAILegacyLlmSettingsSchema);
  registry.register('AnthropicLlmSettings', anthropicLlmSettingsSchema);
  registry.register('GeminiLlmSettings', geminiLlmSettingsSchema);
  registry.register('GroqLlmSettings', groqLlmSettingsSchema);
  registry.register('MistralLlmSettings', mistralLlmSettingsSchema);
  registry.register('DeepSeekLlmSettings', deepSeekLlmSettingsSchema);
  registry.register('OpenRouterLlmSettings', openRouterLlmSettingsSchema);
  registry.register('TogetherAILlmSettings', togetherAILlmSettingsSchema);
  registry.register('FireworksAILlmSettings', fireworksAILlmSettingsSchema);
  registry.register('PerplexityLlmSettings', perplexityLlmSettingsSchema);
  registry.register('CohereLlmSettings', cohereLlmSettingsSchema);
  registry.register('XAILlmSettings', xAILlmSettingsSchema);
  registry.register('LlmSettings', llmSettingsSchema);

  // TTS settings schemas (provider-specific)
  registry.register('ElevenLabsTtsSettings', elevenLabsTtsSettingsSchema);
  registry.register('OpenAiTtsSettings', openAiTtsSettingsSchema);
  registry.register('DeepgramTtsSettings', deepgramTtsSettingsSchema);
  registry.register('CartesiaTtsSettings', cartesiaTtsSettingsSchema);
  registry.register('AzureTtsSettings', azureTtsSettingsSchema);
  registry.register('AmazonPollyTtsSettings', amazonPollyTtsSettingsSchema);

  // Voice and ASR configuration schemas
  registry.register('AsrConfig', asrConfigSchema);
  registry.register('ModerationConfig', moderationConfigSchema);
  registry.register('FillerSettings', fillerSettingsSchema);

  // ASR provider settings schemas
  registry.register('AzureAsrSettings', azureAsrSettingsSchema);
  registry.register('ElevenLabsAsrSettings', elevenLabsAsrSettingsSchema);
  registry.register('DeepgramAsrSettings', deepgramAsrSettingsSchema);
  registry.register('AssemblyAiAsrSettings', assemblyAiAsrSettingsSchema);
  registry.register('SpeechmaticsAsrSettings', speechmaticsAsrSettingsSchema);

  // Storage provider schemas
  registry.register('S3StorageConfig', s3StorageProviderConfigSchema);
  registry.register('S3StorageSettings', s3StorageSettingsSchema);
  registry.register('AzureBlobStorageConfig', azureBlobStorageProviderConfigSchema);
  registry.register('AzureBlobStorageSettings', azureBlobStorageSettingsSchema);
  registry.register('GcsStorageConfig', gcsStorageProviderConfigSchema);
  registry.register('GcsStorageSettings', gcsStorageSettingsSchema);
  registry.register('LocalStorageConfig', localStorageProviderConfigSchema);
  registry.register('LocalStorageSettings', localStorageSettingsSchema);

  // Effect schemas (for stages and global actions)
  registry.register('FieldDescriptor', fieldDescriptorSchema);
  registry.register('EndConversationEffect', endConversationEffectSchema);
  registry.register('AbortConversationEffect', abortConversationEffectSchema);
  registry.register('GoToStageEffect', goToStageEffectSchema);
  registry.register('RunScriptEffect', runScriptEffectSchema);
  registry.register('ModifyUserInputEffect', modifyUserInputEffectSchema);
  registry.register('ModifyVariablesEffect', modifyVariablesEffectSchema);
  registry.register('ModifyUserProfileEffect', modifyUserProfileEffectSchema);
  registry.register('VariableOperation', variableOperationSchema);
  registry.register('UserProfileOperation', userProfileOperationSchema);
  registry.register('CallToolEffect', callToolEffectSchema);
  registry.register('CallWebhookEffect', callWebhookEffectSchema);
  registry.register('GenerateResponseEffect', generateResponseEffectSchema);
  registry.register('Effect', effectSchema);
  registry.register('StageActionParameter', stageActionParameterSchema);
  registry.register('ToolParameter', toolParameterSchema);
  registry.register('StageAction', stageActionSchema);

  // Register main API schemas
  registry.register('CreateOperatorRequest', createOperatorSchema);
  registry.register('UpdateOperatorRequest', updateOperatorBodySchema);
  registry.register('DeleteOperatorRequest', deleteOperatorBodySchema);
  registry.register('OperatorResponse', operatorResponseSchema);
  registry.register('OperatorListResponse', operatorListResponseSchema);
  registry.register('UpdateProfileRequest', updateProfileSchema);
  registry.register('ProfileResponse', profileResponseSchema);
  registry.register('CreateUserRequest', createUserSchema);
  registry.register('UpdateUserRequest', updateUserBodySchema);
  registry.register('UserResponse', userResponseSchema);
  registry.register('UserListResponse', userListResponseSchema);
  registry.register('CreateProjectRequest', createProjectSchema);
  registry.register('UpdateProjectRequest', updateProjectSchema);
  registry.register('ProjectResponse', projectResponseSchema);
  registry.register('ProjectListResponse', projectListResponseSchema);
  registry.register('CreateAgentRequest', createAgentSchema);
  registry.register('UpdateAgentRequest', updateAgentBodySchema);
  registry.register('DeleteAgentRequest', deleteAgentBodySchema);
  registry.register('AgentResponse', agentResponseSchema);
  registry.register('AgentListResponse', agentListResponseSchema);
  registry.register('LoginRequest', loginSchema);
  registry.register('RefreshTokenRequest', refreshTokenSchema);
  registry.register('LoginResponse', loginResponseSchema);
  registry.register('RefreshTokenResponse', refreshTokenResponseSchema);
  registry.register('InitialOperatorSetupRequest', initialOperatorSetupSchema);
  registry.register('SetupStatusResponse', setupStatusResponseSchema);
  registry.register('InitialOperatorSetupResponse', initialOperatorSetupResponseSchema);
  registry.register('CreateKnowledgeCategoryRequest', createKnowledgeCategorySchema);
  registry.register('UpdateKnowledgeCategoryRequest', updateKnowledgeCategoryBodySchema);
  registry.register('DeleteKnowledgeCategoryRequest', deleteKnowledgeCategoryBodySchema);
  registry.register('KnowledgeCategoryResponse', knowledgeCategoryResponseSchema);
  registry.register('KnowledgeCategoryListResponse', knowledgeCategoryListResponseSchema);
  registry.register('CreateKnowledgeItemRequest', createKnowledgeItemSchema);
  registry.register('UpdateKnowledgeItemRequest', updateKnowledgeItemBodySchema);
  registry.register('DeleteKnowledgeItemRequest', deleteKnowledgeItemBodySchema);
  registry.register('KnowledgeItemResponse', knowledgeItemResponseSchema);
  registry.register('KnowledgeItemListResponse', knowledgeItemListResponseSchema);
  registry.register('CreateIssueRequest', createIssueSchema);
  registry.register('UpdateIssueRequest', updateIssueBodySchema);
  registry.register('IssueResponse', issueResponseSchema);
  registry.register('IssueListResponse', issueListResponseSchema);
  registry.register('ConversationResponse', conversationResponseSchema);
  registry.register('ConversationListResponse', conversationListResponseSchema);
  registry.register('ConversationEventResponse', conversationEventResponseSchema);
  registry.register('ConversationEventListResponse', conversationEventListResponseSchema);
  registry.register('CreateStageRequest', createStageSchema);
  registry.register('UpdateStageRequest', updateStageBodySchema);
  registry.register('DeleteStageRequest', deleteStageBodySchema);
  registry.register('StageResponse', stageResponseSchema);
  registry.register('StageListResponse', stageListResponseSchema);
  registry.register('CreateClassifierRequest', createClassifierSchema);
  registry.register('UpdateClassifierRequest', updateClassifierBodySchema);
  registry.register('DeleteClassifierRequest', deleteClassifierBodySchema);
  registry.register('ClassifierResponse', classifierResponseSchema);
  registry.register('ClassifierListResponse', classifierListResponseSchema);
  registry.register('CreateContextTransformerRequest', createContextTransformerSchema);
  registry.register('UpdateContextTransformerRequest', updateContextTransformerBodySchema);
  registry.register('DeleteContextTransformerRequest', deleteContextTransformerBodySchema);
  registry.register('ContextTransformerResponse', contextTransformerResponseSchema);
  registry.register('ContextTransformerListResponse', contextTransformerListResponseSchema);
  registry.register('CreateSmartFunctionTool', createSmartFunctionToolSchema);
  registry.register('CreateWebhookTool', createWebhookToolSchema);
  registry.register('CreateScriptTool', createScriptToolSchema);
  registry.register('ToolType', toolTypeSchema);
  registry.register('CreateToolRequest', createToolSchema);
  registry.register('UpdateToolRequest', updateToolBodySchema);
  registry.register('DeleteToolRequest', deleteToolBodySchema);
  registry.register('ToolResponse', toolResponseSchema);
  registry.register('ToolListResponse', toolListResponseSchema);
  registry.register('CreateGlobalActionRequest', createGlobalActionSchema);
  registry.register('UpdateGlobalActionRequest', updateGlobalActionBodySchema);
  registry.register('DeleteGlobalActionRequest', deleteGlobalActionBodySchema);
  registry.register('GlobalActionResponse', globalActionResponseSchema);
  registry.register('GlobalActionListResponse', globalActionListResponseSchema);
  registry.register('CreateEnvironmentRequest', createEnvironmentSchema);
  registry.register('UpdateEnvironmentRequest', updateEnvironmentBodySchema);
  registry.register('DeleteEnvironmentRequest', deleteEnvironmentBodySchema);
  registry.register('EnvironmentResponse', environmentResponseSchema);
  registry.register('EnvironmentListResponse', environmentListResponseSchema);
  registry.register('CreateGuardrailRequest', createGuardrailSchema);
  registry.register('UpdateGuardrailRequest', updateGuardrailBodySchema);
  registry.register('DeleteGuardrailRequest', deleteGuardrailBodySchema);
  registry.register('CloneGuardrailRequest', cloneGuardrailSchema);
  registry.register('GuardrailResponse', guardrailResponseSchema);
  registry.register('GuardrailListResponse', guardrailListResponseSchema);
  registry.register('CreateProviderRequest', createProviderSchema);
  registry.register('UpdateProviderRequest', updateProviderBodySchema);
  registry.register('DeleteProviderRequest', deleteProviderBodySchema);
  registry.register('ProviderResponse', providerResponseSchema);
  registry.register('ProviderListResponse', providerListResponseSchema);
  registry.register('ProviderModelsResponse', providerModelsResponseSchema);
  // Register reusable sub-schemas first for proper $ref resolution
  registry.register('AsrModelInfo', asrModelInfoSchema);
  registry.register('LlmModelInfo', llmModelInfoSchema);
  registry.register('VoiceInfo', voiceInfoSchema);
  registry.register('LanguageInfo', languageInfoSchema);
  registry.register('TtsModelInfo', ttsModelInfoSchema);
  registry.register('ModerationCategoryInfo', moderationCategoryInfoSchema);
  registry.register('ModerationModelInfo', moderationModelInfoSchema);
  registry.register('ModerationProviderInfo', moderationProviderInfoSchema);

  registry.register('ProviderCatalog', providerCatalogSchema);
  registry.register('AsrProvidersResponse', asrProvidersResponseSchema);
  registry.register('TtsProvidersResponse', ttsProvidersResponseSchema);
  registry.register('LlmProvidersResponse', llmProvidersResponseSchema);
  registry.register('AsrProviderInfo', asrProviderInfoSchema);
  registry.register('TtsProviderInfo', ttsProviderInfoSchema);
  registry.register('LlmProviderInfo', llmProviderInfoSchema);
  registry.register('AuditLogResponse', auditLogResponseSchema);
  registry.register('AuditLogListResponse', auditLogListResponseSchema);
  registry.register('CreateApiKeyRequest', createApiKeySchema);
  registry.register('UpdateApiKeyRequest', updateApiKeySchema);
  registry.register('DeleteApiKeyRequest', deleteApiKeyBodySchema);
  registry.register('ApiKeyResponse', apiKeyResponseSchema);
  registry.register('ApiKeyListResponse', apiKeyListResponseSchema);

  // Register Operator routes from OperatorController
  const operatorPaths = OperatorController.getOpenAPIPaths();
  for (const path of operatorPaths) {
    registry.registerPath(path);
  }

  // Register Auth routes from AuthController
  const authPaths = AuthController.getOpenAPIPaths();
  for (const path of authPaths) {
    registry.registerPath(path);
  }

  // Register Setup routes from SetupController
  const setupPaths = SetupController.getOpenAPIPaths();
  for (const path of setupPaths) {
    registry.registerPath(path);
  }

  // Register Project routes from ProjectController
  const projectPaths = ProjectController.getOpenAPIPaths();
  for (const path of projectPaths) {
    registry.registerPath(path);
  }

  // Register Audit routes from AuditController
  const auditPaths = AuditController.getOpenAPIPaths();
  for (const path of auditPaths) {
    registry.registerPath(path);
  }

  // Register Analytics routes from AnalyticsController
  registry.register('LatencyMetric', latencyMetricSchema);
  registry.register('PercentileSet', percentileSetSchema);
  registry.register('LatencyTrendPoint', latencyTrendPointSchema);
  const analyticsPaths = AnalyticsController.getOpenAPIPaths();
  for (const path of analyticsPaths) {
    registry.registerPath(path);
  }

  // Register Classifier routes from ClassifierController
  const classifierPaths = ClassifierController.getOpenAPIPaths();
  for (const path of classifierPaths) {
    registry.registerPath(path);
  }

  // Register ContextTransformer routes from ContextTransformerController
  const contextTransformerPaths = ContextTransformerController.getOpenAPIPaths();
  for (const path of contextTransformerPaths) {
    registry.registerPath(path);
  }

  // Register Conversation routes from ConversationController
  const conversationPaths = ConversationController.getOpenAPIPaths();
  for (const path of conversationPaths) {
    registry.registerPath(path);
  }

  // Register Knowledge routes from KnowledgeController
  const knowledgePaths = KnowledgeController.getOpenAPIPaths();
  for (const path of knowledgePaths) {
    registry.registerPath(path);
  }

  // Register Agent routes from AgentController
  const agentPaths = AgentController.getOpenAPIPaths();
  for (const path of agentPaths) {
    registry.registerPath(path);
  }

  // Register Provider routes from ProviderController
  const providerPaths = ProviderController.getOpenAPIPaths();
  for (const path of providerPaths) {
    registry.registerPath(path);
  }

  // Register ProviderCatalog routes from ProviderCatalogController
  const providerCatalogPaths = ProviderCatalogController.getOpenAPIPaths();
  for (const path of providerCatalogPaths) {
    registry.registerPath(path);
  }

  // Register Environment routes from EnvironmentController
  const environmentPaths = EnvironmentController.getOpenAPIPaths();
  for (const path of environmentPaths) {
    registry.registerPath(path);
  }

  // Register GlobalAction routes from GlobalActionController
  const globalActionPaths = GlobalActionController.getOpenAPIPaths();
  for (const path of globalActionPaths) {
    registry.registerPath(path);
  }

  // Register Guardrail routes from GuardrailController
  const guardrailPaths = GuardrailController.getOpenAPIPaths();
  for (const path of guardrailPaths) {
    registry.registerPath(path);
  }

  // Register Issue routes from IssueController
  const issuePaths = IssueController.getOpenAPIPaths();
  for (const path of issuePaths) {
    registry.registerPath(path);
  }

  // Register Stage routes from StageController
  const stagePaths = StageController.getOpenAPIPaths();
  for (const path of stagePaths) {
    registry.registerPath(path);
  }

  // Register Tool routes from ToolController
  const toolPaths = ToolController.getOpenAPIPaths();
  for (const path of toolPaths) {
    registry.registerPath(path);
  }

  // Register User routes from UserController
  const userPaths = UserController.getOpenAPIPaths();
  for (const path of userPaths) {
    registry.registerPath(path);
  }

  // Register ApiKey routes from ApiKeyController
  const apiKeyPaths = ApiKeyController.getOpenAPIPaths();
  for (const path of apiKeyPaths) {
    registry.registerPath(path);
  }

  // Register Version routes from VersionController
  registry.register('VersionResponse', versionResponseSchema);
  const versionPaths = VersionController.getOpenAPIPaths();
  for (const path of versionPaths) {
    registry.registerPath(path);
  }

  // Register Migration routes from MigrationController
  registry.register('EntityStub', entityStubSchema);
  registry.register('MigrationEntityCount', migrationEntityCountSchema);
  registry.register('MigrationResult', migrationResultSchema);
  registry.register('MigrationJob', migrationJobSchema);
  registry.register('MigrationPreview', migrationPreviewSchema);
  registry.register('ExportBundle', exportBundleSchema);
  const migrationPaths = MigrationController.getOpenAPIPaths();
  for (const path of migrationPaths) {
    registry.registerPath(path);
  }

  // Register Project Exchange schemas and routes
  registry.register('ProviderHint', providerHintSchema);
  registry.register('ProviderHintResolutionTarget', providerHintResolutionTargetSchema);
  registry.register('ProviderHintResolution', providerHintResolutionSchema);
  registry.register('AsrConfigExchangeV1', asrConfigExchangeV1Schema);
  registry.register('StorageConfigExchangeV1', storageConfigExchangeV1Schema);
  registry.register('ModerationConfigExchangeV1', moderationConfigExchangeV1Schema);
  registry.register('FillerSettingsExchangeV1', fillerSettingsExchangeV1Schema);
  registry.register('ProjectExchangeV1', projectExchangeV1Schema);
  registry.register('AgentExchangeV1', agentExchangeV1Schema);
  registry.register('StageExchangeV1', stageExchangeV1Schema);
  registry.register('ClassifierExchangeV1', classifierExchangeV1Schema);
  registry.register('ContextTransformerExchangeV1', contextTransformerExchangeV1Schema);
  registry.register('ToolExchangeV1', toolExchangeV1Schema);
  registry.register('GlobalActionExchangeV1', globalActionExchangeV1Schema);
  registry.register('GuardrailExchangeV1', guardrailExchangeV1Schema);
  registry.register('KnowledgeCategoryExchangeV1', knowledgeCategoryExchangeV1Schema);
  registry.register('KnowledgeItemExchangeV1', knowledgeItemExchangeV1Schema);
  registry.register('ProjectExchangeBundleV1', projectExchangeBundleV1Schema);
  registry.register('ProjectExchangeImportResult', projectExchangeImportResultSchema);
  const projectExchangePaths = ProjectExchangeController.getOpenAPIPaths();
  for (const path of projectExchangePaths) {
    registry.registerPath(path);
  }

  const generator = new OpenApiGeneratorV3(registry.definitions);

  const document = generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Bonsai Operator API',
      description: 'API documentation for Bonsai Operator API with JWT authentication',
      version: '0.1.0',
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
    ],
  });

  // Add security schemes to the generated document
  document.components = document.components || {};
  document.components.securitySchemes = {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'JWT access token obtained from /api/auth/login',
    },
  };

  // Apply security globally (except for public routes which don't require it)
  document.security = [{ bearerAuth: [] }];

  cachedOpenAPISpec = document;
  return cachedOpenAPISpec;
}

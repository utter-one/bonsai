import 'reflect-metadata';
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { createAdminSchema, updateAdminBodySchema, deleteAdminBodySchema, adminResponseSchema, adminListResponseSchema } from './api/admin';
import { createUserSchema, updateUserBodySchema, userResponseSchema, userListResponseSchema } from './api/user';
import { createPersonaSchema, updatePersonaBodySchema, deletePersonaBodySchema, personaResponseSchema, personaListResponseSchema } from './api/persona';
import { loginSchema, refreshTokenSchema, loginResponseSchema, refreshTokenResponseSchema } from './api/auth';
import { initialAdminSetupSchema, setupStatusResponseSchema, initialAdminSetupResponseSchema } from './api/setup';
import { createKnowledgeSectionSchema, updateKnowledgeSectionSchema, knowledgeSectionResponseSchema, knowledgeSectionListResponseSchema, createKnowledgeCategorySchema, updateKnowledgeCategoryBodySchema, deleteKnowledgeCategoryBodySchema, knowledgeCategoryResponseSchema, knowledgeCategoryListResponseSchema, createKnowledgeItemSchema, updateKnowledgeItemBodySchema, deleteKnowledgeItemBodySchema, knowledgeItemResponseSchema, knowledgeItemListResponseSchema } from './api/knowledge';
import { createIssueSchema, updateIssueBodySchema, issueResponseSchema, issueListResponseSchema } from './api/issue';
import { conversationResponseSchema, conversationListResponseSchema, conversationEventResponseSchema, conversationEventListResponseSchema } from './api/conversation';
import { createStageSchema, updateStageBodySchema, deleteStageBodySchema, stageResponseSchema, stageListResponseSchema } from './api/stage';
import { createClassifierSchema, updateClassifierBodySchema, deleteClassifierBodySchema, classifierResponseSchema, classifierListResponseSchema } from './api/classifier';
import { createContextTransformerSchema, updateContextTransformerBodySchema, deleteContextTransformerBodySchema, contextTransformerResponseSchema, contextTransformerListResponseSchema } from './api/contextTransformer';
import { createToolSchema, updateToolBodySchema, deleteToolBodySchema, toolResponseSchema, toolListResponseSchema } from './api/tool';
import { createGlobalActionSchema, updateGlobalActionBodySchema, deleteGlobalActionBodySchema, globalActionResponseSchema, globalActionListResponseSchema } from './api/globalAction';
import { createEnvironmentSchema, updateEnvironmentBodySchema, deleteEnvironmentBodySchema, environmentResponseSchema, environmentListResponseSchema } from './api/environment';
import { createProviderSchema, updateProviderBodySchema, deleteProviderBodySchema, providerResponseSchema, providerListResponseSchema } from './api/provider';
import { auditLogResponseSchema, auditLogListResponseSchema } from './api/audit';
import { listParamsSchema } from './api/common';
import { getOpenAPIMetadata } from './decorators/openapi';
import { AdminController } from './controllers/AdminController';
import { UserController } from './controllers/UserController';
import { PersonaController } from './controllers/PersonaController';
import { AuthController } from './controllers/AuthController';
import { SetupController } from './controllers/SetupController';
import { KnowledgeController } from './controllers/KnowledgeController';
import { IssueController } from './controllers/IssueController';
import { ConversationController } from './controllers/ConversationController';
import { StageController } from './controllers/StageController';
import { ClassifierController } from './controllers/ClassifierController';
import { ContextTransformerController } from './controllers/ContextTransformerController';
import { ToolController } from './controllers/ToolController';
import { GlobalActionController } from './controllers/GlobalActionController';
import { EnvironmentController } from './controllers/EnvironmentController';
import { ProviderController } from './controllers/ProviderController';
import { AuditController } from './controllers/AuditController';
import { getMetadataArgsStorage } from 'routing-controllers';

extendZodWithOpenApi(z);

// Define param schemas
const adminIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Admin user ID', example: 'admin-123' }),
});

const userIdParamSchema = z.object({
  id: z.string().openapi({ description: 'User ID', example: 'user-123' }),
});

const personaIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Persona ID', example: 'persona-123' }),
});

const knowledgeSectionIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Knowledge section ID', example: 'section-123' }),
});

const knowledgeCategoryIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Knowledge category ID', example: 'category-123' }),
  categoryId: z.string().optional().openapi({ description: 'Knowledge category ID (for nested routes)', example: 'category-123' }),
});

const knowledgeItemIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Knowledge item ID', example: 'item-123' }),
});

const issueIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Issue ID', example: '1' }),
});

const conversationIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Conversation ID', example: 'conv-123' }),
});

const conversationEventIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Conversation ID', example: 'conv-123' }),
  eventId: z.string().openapi({ description: 'Event ID', example: 'event-123' }),
});

const stageIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Stage ID', example: 'stage-123' }),
});

const classifierIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Classifier ID', example: 'classifier-123' }),
});

const contextTransformerIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Context transformer ID', example: 'transformer-123' }),
});

const toolIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Tool ID', example: 'tool-123' }),
});

const globalActionIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Global action ID', example: 'action-123' }),
});

const environmentIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Environment ID', example: 'env-123' }),
});

const providerIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Provider ID', example: 'provider-123' }),
});

/**
 * Generate OpenAPI specification from Zod schemas and controller decorators
 */
export function getOpenAPISpec(): any {
  const registry = new OpenAPIRegistry();

  // Register schemas
  registry.register('CreateAdminRequest', createAdminSchema);
  registry.register('UpdateAdminRequest', updateAdminBodySchema);
  registry.register('DeleteAdminRequest', deleteAdminBodySchema);
  registry.register('AdminResponse', adminResponseSchema);
  registry.register('AdminListResponse', adminListResponseSchema);
  registry.register('CreateUserRequest', createUserSchema);
  registry.register('UpdateUserRequest', updateUserBodySchema);
  registry.register('UserResponse', userResponseSchema);
  registry.register('UserListResponse', userListResponseSchema);
  registry.register('CreatePersonaRequest', createPersonaSchema);
  registry.register('UpdatePersonaRequest', updatePersonaBodySchema);
  registry.register('DeletePersonaRequest', deletePersonaBodySchema);
  registry.register('PersonaResponse', personaResponseSchema);
  registry.register('PersonaListResponse', personaListResponseSchema);
  registry.register('LoginRequest', loginSchema);
  registry.register('RefreshTokenRequest', refreshTokenSchema);
  registry.register('LoginResponse', loginResponseSchema);
  registry.register('RefreshTokenResponse', refreshTokenResponseSchema);
  registry.register('InitialAdminSetupRequest', initialAdminSetupSchema);
  registry.register('SetupStatusResponse', setupStatusResponseSchema);
  registry.register('InitialAdminSetupResponse', initialAdminSetupResponseSchema);
  registry.register('CreateKnowledgeSectionRequest', createKnowledgeSectionSchema);
  registry.register('UpdateKnowledgeSectionRequest', updateKnowledgeSectionSchema);
  registry.register('KnowledgeSectionResponse', knowledgeSectionResponseSchema);
  registry.register('KnowledgeSectionListResponse', knowledgeSectionListResponseSchema);
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
  registry.register('CreateProviderRequest', createProviderSchema);
  registry.register('UpdateProviderRequest', updateProviderBodySchema);
  registry.register('DeleteProviderRequest', deleteProviderBodySchema);
  registry.register('ProviderResponse', providerResponseSchema);
  registry.register('ProviderListResponse', providerListResponseSchema);
  registry.register('AuditLogResponse', auditLogResponseSchema);
  registry.register('AuditLogListResponse', auditLogListResponseSchema);
  registry.register('ListParams', listParamsSchema);

  // Get routing-controllers metadata
  const metadata = getMetadataArgsStorage();
  const controllers = [AuthController, SetupController, AdminController, UserController, 
    ConversationController, StageController, ClassifierController, ContextTransformerController, ToolController, 
    PersonaController, KnowledgeController, IssueController, GlobalActionController, EnvironmentController, ProviderController, AuditController];

  // Map of param schemas for different routes
  const paramSchemaMap: Record<string, any> = {
    '/api/admins/:id': adminIdParamSchema,
    '/api/users/:id': userIdParamSchema,
    '/api/personas/:id': personaIdParamSchema,
    '/api/knowledge/sections/:id': knowledgeSectionIdParamSchema,
    '/api/knowledge/categories/:id': knowledgeCategoryIdParamSchema,
    '/api/knowledge/categories/:categoryId': knowledgeCategoryIdParamSchema,
    '/api/knowledge/items/:id': knowledgeItemIdParamSchema,
    '/api/issues/:id': issueIdParamSchema,
    '/api/conversations/:id': conversationIdParamSchema,
    '/api/conversations/:id/events/:eventId': conversationEventIdParamSchema,
    '/api/stages/:id': stageIdParamSchema,
    '/api/classifiers/:id': classifierIdParamSchema,
    '/api/context-transformers/:id': contextTransformerIdParamSchema,
    '/api/tools/:id': toolIdParamSchema,
    '/api/global-actions/:id': globalActionIdParamSchema,
    '/api/environments/:id': environmentIdParamSchema,
    '/api/providers/:id': providerIdParamSchema,
  };

  // Register API paths from controller metadata
  for (const controllerClass of controllers) {
    const controllerMetadata = metadata.controllers.find(c => c.target === controllerClass);
    if (!controllerMetadata) continue;

    const actions = metadata.actions.filter(a => a.target === controllerClass);

    for (const action of actions) {
      const openAPIConfig = getOpenAPIMetadata(controllerClass.prototype, action.method);
      if (!openAPIConfig || !openAPIConfig.responses) continue;

      // Build the full path
      const basePath = controllerMetadata.route || '';
      const actionPath = action.route || '';
      const fullPath = `${basePath}${actionPath}`.replace(/\/\//g, '/');

      // Determine if this route has params
      const hasParams = fullPath.includes(':id') || fullPath.includes(':categoryId') || fullPath.includes(':eventId');
      const paramKey = fullPath.replace(/\/\d+$/, '/:id').replace(/\/audit-logs$/, '').replace(/\/items$/, '').replace(/\/events$/, '');
      const paramSchema = hasParams && !fullPath.includes('/audit-logs') && !fullPath.endsWith('/items') && !fullPath.endsWith('/events') ? paramSchemaMap[paramKey] : undefined;

      // Build request object
      const request: any = { ...openAPIConfig.request };
      if (paramSchema) {
        request.params = paramSchema;
      }

      registry.registerPath({
        method: action.type as any,
        path: fullPath,
        tags: openAPIConfig.tags,
        summary: openAPIConfig.summary,
        description: openAPIConfig.description,
        request,
        responses: openAPIConfig.responses as any,
      });
    }
  }

  const generator = new OpenApiGeneratorV3(registry.definitions);

  const document = generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Nexus Admin API',
      description: 'API documentation for Nexus Admin API with JWT authentication',
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

  return document;
}

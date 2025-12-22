import 'reflect-metadata';
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { createAdminSchema, updateAdminBodySchema, deleteAdminBodySchema, adminResponseSchema, adminListResponseSchema } from './api/admin';
import { createUserSchema, updateUserBodySchema, userResponseSchema, userListResponseSchema } from './api/user';
import { createPersonaSchema, updatePersonaBodySchema, deletePersonaBodySchema, personaResponseSchema, personaListResponseSchema } from './api/persona';
import { loginSchema, refreshTokenSchema, loginResponseSchema, refreshTokenResponseSchema } from './api/auth';
import { createKnowledgeSectionSchema, updateKnowledgeSectionSchema, knowledgeSectionResponseSchema, knowledgeSectionListResponseSchema, createKnowledgeCategorySchema, updateKnowledgeCategoryBodySchema, deleteKnowledgeCategoryBodySchema, knowledgeCategoryResponseSchema, knowledgeCategoryListResponseSchema, createKnowledgeItemSchema, updateKnowledgeItemBodySchema, deleteKnowledgeItemBodySchema, knowledgeItemResponseSchema, knowledgeItemListResponseSchema } from './api/knowledge';
import { listParamsSchema } from './api/common';
import { getOpenAPIMetadata } from './decorators/openapi';
import { AdminController } from './controllers/AdminController';
import { UserController } from './controllers/UserController';
import { PersonaController } from './controllers/PersonaController';
import { AuthController } from './controllers/AuthController';
import { KnowledgeController } from './controllers/KnowledgeController';
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
  registry.register('ListParams', listParamsSchema);

  // Get routing-controllers metadata
  const metadata = getMetadataArgsStorage();
  const controllers = [AdminController, UserController, PersonaController, AuthController, KnowledgeController];

  // Map of param schemas for different routes
  const paramSchemaMap: Record<string, any> = {
    '/api/admins/:id': adminIdParamSchema,
    '/api/users/:id': userIdParamSchema,
    '/api/personas/:id': personaIdParamSchema,
    '/api/knowledge/sections/:id': knowledgeSectionIdParamSchema,
    '/api/knowledge/categories/:id': knowledgeCategoryIdParamSchema,
    '/api/knowledge/categories/:categoryId': knowledgeCategoryIdParamSchema,
    '/api/knowledge/items/:id': knowledgeItemIdParamSchema,
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
      const hasParams = fullPath.includes(':id') || fullPath.includes(':categoryId');
      const paramKey = fullPath.replace(/\/\d+$/, '/:id').replace(/\/audit-logs$/, '').replace(/\/items$/, '');
      const paramSchema = hasParams && !fullPath.includes('/audit-logs') && !fullPath.endsWith('/items') ? paramSchemaMap[paramKey] : undefined;

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

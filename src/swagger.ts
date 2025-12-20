import 'reflect-metadata';
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { createAdminSchema, updateAdminBodySchema, deleteAdminBodySchema, adminResponseSchema, adminListResponseSchema } from './api/admin';
import { createUserSchema, updateUserBodySchema, userResponseSchema, userListResponseSchema } from './api/user';
import { createPersonaSchema, updatePersonaBodySchema, deletePersonaBodySchema, personaResponseSchema, personaListResponseSchema } from './api/persona';
import { listParamsSchema } from './api/common';
import { getOpenAPIMetadata } from './decorators/openapi';
import { AdminController } from './controllers/AdminController';
import { UserController } from './controllers/UserController';
import { PersonaController } from './controllers/PersonaController';
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
  registry.register('ListParams', listParamsSchema);

  // Get routing-controllers metadata
  const metadata = getMetadataArgsStorage();
  const controllers = [AdminController, UserController, PersonaController];

  // Map of param schemas for different routes
  const paramSchemaMap: Record<string, any> = {
    '/api/admins/:id': adminIdParamSchema,
    '/api/users/:id': userIdParamSchema,
    '/api/personas/:id': personaIdParamSchema,
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
      const hasParams = fullPath.includes(':id');
      const paramKey = fullPath.replace(/\/\d+$/, '/:id').replace(/\/audit-logs$/, '');
      const paramSchema = hasParams && !fullPath.includes('/audit-logs') ? paramSchemaMap[paramKey] : undefined;

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

  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Nexus Admin API',
      description: 'API documentation for Nexus Admin API',
      version: '0.1.0',
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
    ],
  });
}

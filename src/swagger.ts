import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { createAdminSchema, updateAdminBodySchema, deleteAdminBodySchema, adminResponseSchema, adminListResponseSchema } from './api/admin';
import { listParamsSchema } from './api/common';

extendZodWithOpenApi(z);

// Define param schemas
const idParamSchema = z.object({
  id: z.string().openapi({ description: 'Admin user ID', example: 'admin-123' }),
});

/**
 * Generate OpenAPI specification from Zod schemas
 */
export function getOpenAPISpec(): any {
  const registry = new OpenAPIRegistry();

  // Register schemas
  registry.register('CreateAdminRequest', createAdminSchema);
  registry.register('UpdateAdminRequest', updateAdminBodySchema);
  registry.register('DeleteAdminRequest', deleteAdminBodySchema);
  registry.register('AdminResponse', adminResponseSchema);
  registry.register('AdminListResponse', adminListResponseSchema);
  registry.register('ListParams', listParamsSchema);

  // Register API paths
  registry.registerPath({
    method: 'post',
    path: '/api/admins',
    summary: 'Create a new admin user',
    description: 'Creates a new admin user with the specified credentials and roles',
    request: {
      body: {
        content: {
          'application/json': {
            schema: createAdminSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Admin user created successfully',
        content: {
          'application/json': {
            schema: adminResponseSchema,
          },
        },
      },
      400: { description: 'Invalid request body' },
      409: { description: 'Admin user already exists' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/admins/{id}',
    summary: 'Get admin user by ID',
    description: 'Retrieves a single admin user by their unique identifier',
    request: {
      params: idParamSchema,
    },
    responses: {
      200: {
        description: 'Admin user retrieved successfully',
        content: {
          'application/json': {
            schema: adminResponseSchema,
          },
        },
      },
      404: { description: 'Admin user not found' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/admins',
    summary: 'List admin users',
    description: 'Retrieves a paginated list of admin users with optional filtering',
    request: {
      query: listParamsSchema,
    },
    responses: {
      200: {
        description: 'List of admin users retrieved successfully',
        content: {
          'application/json': {
            schema: adminListResponseSchema,
          },
        },
      },
      400: { description: 'Invalid query parameters' },
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/api/admins/{id}',
    summary: 'Update admin user',
    description: 'Updates an existing admin user with optimistic locking',
    request: {
      params: idParamSchema,
      body: {
        content: {
          'application/json': {
            schema: updateAdminBodySchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Admin user updated successfully',
        content: {
          'application/json': {
            schema: adminResponseSchema,
          },
        },
      },
      400: { description: 'Invalid request body' },
      404: { description: 'Admin user not found' },
      409: { description: 'Version conflict - entity was modified' },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/admins/{id}',
    summary: 'Delete admin user',
    description: 'Deletes an admin user with optimistic locking',
    request: {
      params: idParamSchema,
      body: {
        content: {
          'application/json': {
            schema: deleteAdminBodySchema,
          },
        },
      },
    },
    responses: {
      204: { description: 'Admin user deleted successfully' },
      400: { description: 'Invalid request body' },
      404: { description: 'Admin user not found' },
      409: { description: 'Version conflict - entity was modified' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/admins/{id}/audit-logs',
    summary: 'Get admin audit logs',
    description: 'Retrieves audit logs for a specific admin user',
    request: {
      params: idParamSchema,
    },
    responses: {
      200: {
        description: 'Audit logs retrieved successfully',
        content: {
          'application/json': {
            schema: z.array(z.object({})),
          },
        },
      },
      404: { description: 'Admin user not found' },
    },
  });

  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Nexus Backend API',
      description: 'API documentation for Nexus Backend',
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

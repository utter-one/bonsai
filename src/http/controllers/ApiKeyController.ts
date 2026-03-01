import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { ApiKeyService } from '../../services/ApiKeyService';
import { createApiKeySchema, updateApiKeySchema, apiKeyRouteParamsSchema, deleteApiKeyBodySchema, apiKeyResponseSchema, apiKeyListResponseSchema } from '../contracts/apiKey';
import type { UpdateApiKeyRequest, DeleteApiKeyRequest } from '../contracts/apiKey';
import { listParamsSchema, projectScopedParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for API key management with explicit routing
 * Handles CRUD operations for API keys used in WebSocket authentication
 */
@singleton()
export class ApiKeyController {
  constructor(@inject(ApiKeyService) private readonly apiKeyService: ApiKeyService) { }

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    const apiKeyIdParamSchema = apiKeyRouteParamsSchema;

    return [
      {
        method: 'post',
        path: '/api/projects/{projectId}/api-keys',
        tags: ['API Keys'],
        summary: 'Create a new API key',
        description: 'Creates a new API key for WebSocket authentication. The secret key is only returned in the response to this creation request.',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createApiKeySchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'API key created successfully. The secret key is included in this response only.',
            content: {
              'application/json': {
                schema: apiKeyResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Project not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/api-keys/{id}',
        tags: ['API Keys'],
        summary: 'Get API key by ID',
        description: 'Retrieves a single API key by its unique identifier. The full secret key is never returned, only a preview.',
        request: {
          params: apiKeyIdParamSchema,
        },
        responses: {
          200: {
            description: 'API key retrieved successfully',
            content: {
              'application/json': {
                schema: apiKeyResponseSchema,
              },
            },
          },
          404: { description: 'API key not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/api-keys',
        tags: ['API Keys'],
        summary: 'List API keys',
        description: 'Retrieves a list of API keys with optional filtering, sorting, and pagination. Filter by projectId to get keys for a specific project.',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'API keys retrieved successfully',
            content: {
              'application/json': {
                schema: apiKeyListResponseSchema,
              },
            },
          },
        },
      },
      {
        method: 'get',
        path: '/api/api-keys',
        tags: ['API Keys'],
        summary: 'List all API keys',
        description: 'Retrieves a list of all API keys across all projects with optional filtering, sorting, and pagination.',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'All API keys retrieved successfully',
            content: {
              'application/json': {
                schema: apiKeyListResponseSchema,
              },
            },
          },
        },
      },
      {
        method: 'put',
        path: '/api/projects/{projectId}/api-keys/{id}',
        tags: ['API Keys'],
        summary: 'Update API key',
        description: 'Updates an existing API key with optimistic locking support. Can update name, active status, and metadata.',
        request: {
          params: apiKeyIdParamSchema,
          body: {
            content: {
              'application/json': {
                schema: updateApiKeySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'API key updated successfully',
            content: {
              'application/json': {
                schema: apiKeyResponseSchema,
              },
            },
          },
          404: { description: 'API key not found' },
          409: { description: 'Version conflict - API key was modified by another request' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/api-keys/{id}',
        tags: ['API Keys'],
        summary: 'Delete API key',
        description: 'Permanently deletes an API key. This action cannot be undone and will immediately invalidate the key.',
        request: {
          params: apiKeyIdParamSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteApiKeyBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'API key deleted successfully' },
          404: { description: 'API key not found' },
          409: { description: 'Version conflict - API key was modified by another request' },
        },
      },
    ];
  }

  /**
   * Register routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/projects/:projectId/api-keys', asyncHandler(this.createApiKey.bind(this)));
    router.get('/api/projects/:projectId/api-keys/:id', asyncHandler(this.getApiKey.bind(this)));
    router.get('/api/projects/:projectId/api-keys', asyncHandler(this.listApiKeys.bind(this)));
    router.get('/api/api-keys', asyncHandler(this.listAllApiKeys.bind(this)));
    router.put('/api/projects/:projectId/api-keys/:id', asyncHandler(this.updateApiKey.bind(this)));
    router.delete('/api/projects/:projectId/api-keys/:id', asyncHandler(this.deleteApiKey.bind(this)));
  }

  /**
   * Create a new API key
   */
  private async createApiKey(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.API_KEY_WRITE]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const body = createApiKeySchema.parse(req.body);
    const result = await this.apiKeyService.createApiKey(projectId, body, req.context);
    res.status(201).json(result);
  }

  /**
   * Get API key by ID
   */
  private async getApiKey(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.API_KEY_READ]);
    const params = apiKeyRouteParamsSchema.parse(req.params);
    const result = await this.apiKeyService.getApiKeyById(params.projectId, params.id);
    res.status(200).json(result);
  }

  /**
   * List API keys with filtering and pagination
   */
  private async listApiKeys(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.API_KEY_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const result = await this.apiKeyService.listApiKeys(projectId, query);
    res.status(200).json(result);
  }

  /**
   * List all API keys across all projects with filtering and pagination
   */
  private async listAllApiKeys(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.API_KEY_READ]);
    const query = listParamsSchema.parse(req.query);
    const result = await this.apiKeyService.listApiKeys(undefined, query);
    res.status(200).json(result);
  }

  /**
   * Update an existing API key
   */
  private async updateApiKey(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.API_KEY_WRITE]);
    const params = apiKeyRouteParamsSchema.parse(req.params);
    const body = updateApiKeySchema.parse(req.body) as UpdateApiKeyRequest;
    const result = await this.apiKeyService.updateApiKey(params.projectId, params.id, body, req.context);
    res.status(200).json(result);
  }

  /**
   * Delete an API key
   */
  private async deleteApiKey(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.API_KEY_DELETE]);
    const params = apiKeyRouteParamsSchema.parse(req.params);
    const body = deleteApiKeyBodySchema.parse(req.body) as DeleteApiKeyRequest;
    await this.apiKeyService.deleteApiKey(params.projectId, params.id, body.version, req.context);
    res.status(204).send();
  }
}

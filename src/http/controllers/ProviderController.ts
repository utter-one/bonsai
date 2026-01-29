import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { ProviderService } from '../../services/providers/ProviderService';
import { createProviderSchema, updateProviderBodySchema, deleteProviderBodySchema, providerRouteParamsSchema, providerResponseSchema, providerListResponseSchema } from '../contracts/provider';
import { listParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for provider configuration management with explicit routing
 */
@singleton()
export class ProviderController {
  constructor(@inject(ProviderService) private readonly providerService: ProviderService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/providers',
        tags: ['Providers'],
        summary: 'Create a new provider',
        description: 'Creates a new provider configuration for AI services (ASR, TTS, LLM, Embeddings)',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createProviderSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Provider created successfully',
            content: {
              'application/json': {
                schema: providerResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'Provider already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/providers/{id}',
        tags: ['Providers'],
        summary: 'Get provider by ID',
        description: 'Retrieves a single provider configuration by its unique identifier',
        request: {
          params: providerRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Provider retrieved successfully',
            content: {
              'application/json': {
                schema: providerResponseSchema,
              },
            },
          },
          404: { description: 'Provider not found' },
        },
      },
      {
        method: 'get',
        path: '/api/providers',
        tags: ['Providers'],
        summary: 'List providers',
        description: 'Retrieves a paginated list of provider configurations with optional filtering by providerType, apiType, tags, etc.',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of providers retrieved successfully',
            content: {
              'application/json': {
                schema: providerListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/providers/{id}',
        tags: ['Providers'],
        summary: 'Update provider',
        description: 'Updates an existing provider configuration with optimistic locking',
        request: {
          params: providerRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateProviderBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Provider updated successfully',
            content: {
              'application/json': {
                schema: providerResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Provider not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'delete',
        path: '/api/providers/{id}',
        tags: ['Providers'],
        summary: 'Delete provider',
        description: 'Deletes a provider configuration with optimistic locking',
        request: {
          params: providerRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteProviderBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Provider deleted successfully' },
          400: { description: 'Invalid request body' },
          404: { description: 'Provider not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'get',
        path: '/api/providers/{id}/audit-logs',
        tags: ['Providers'],
        summary: 'Get provider audit logs',
        description: 'Retrieves audit logs for a specific provider configuration',
        request: {
          params: providerRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Provider not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/providers', asyncHandler(this.createProvider.bind(this)));
    router.get('/api/providers/:id', asyncHandler(this.getProviderById.bind(this)));
    router.get('/api/providers', asyncHandler(this.listProviders.bind(this)));
    router.put('/api/providers/:id', asyncHandler(this.updateProvider.bind(this)));
    router.delete('/api/providers/:id', asyncHandler(this.deleteProvider.bind(this)));
    router.get('/api/providers/:id/audit-logs', asyncHandler(this.getProviderAuditLogs.bind(this)));
  }

  /**
   * POST /api/providers
   * Create a new provider
   */
  private async createProvider(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROVIDER_WRITE]);
    const body = createProviderSchema.parse(req.body);
    const provider = await this.providerService.createProvider(body, req.context);
    res.status(201).json(provider);
  }

  /**
   * GET /api/providers/:id
   * Get a provider by ID
   */
  private async getProviderById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROVIDER_READ]);
    const params = providerRouteParamsSchema.parse(req.params);
    const provider = await this.providerService.getProviderById(params.id, req.context);
    res.status(200).json(provider);
  }

  /**
   * GET /api/providers
   * List providers with optional filters
   */
  private async listProviders(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROVIDER_READ]);
    const query = listParamsSchema.parse(req.query);
    const providers = await this.providerService.listProviders(query, req.context);
    res.status(200).json(providers);
  }

  /**
   * PUT /api/providers/:id
   * Update a provider
   */
  private async updateProvider(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROVIDER_WRITE]);
    const params = providerRouteParamsSchema.parse(req.params);
    const body = updateProviderBodySchema.parse(req.body);
    const provider = await this.providerService.updateProvider(params.id, body, req.context);
    res.status(200).json(provider);
  }

  /**
   * DELETE /api/providers/:id
   * Delete a provider
   */
  private async deleteProvider(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROVIDER_DELETE]);
    const params = providerRouteParamsSchema.parse(req.params);
    const body = deleteProviderBodySchema.parse(req.body);
    const { version } = body;
    await this.providerService.deleteProvider(params.id, version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/providers/:id/audit-logs
   * Get audit logs for a provider
   */
  private async getProviderAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = providerRouteParamsSchema.parse(req.params);
    const auditLogs = await this.providerService.getProviderAuditLogs(params.id, req.context);
    res.status(200).json(auditLogs);
  }
}

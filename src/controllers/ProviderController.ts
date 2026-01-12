import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, Body, QueryParams, HttpCode, Req } from 'routing-controllers';
import { injectable, inject } from 'tsyringe';
import { Validated } from '../decorators/validation';
import { OpenAPI } from '../decorators/openapi';
import { RequirePermissions } from '../decorators/auth';
import { PERMISSIONS } from '../permissions';
import type { Request } from 'express';
import { ProviderService } from '../services/providers/ProviderService';
import { createProviderSchema, updateProviderBodySchema, deleteProviderBodySchema, providerResponseSchema, providerListResponseSchema } from '../api/provider';
import type { CreateProviderRequest, UpdateProviderRequest, DeleteProviderRequest } from '../api/provider';
import { listParamsSchema } from '../api/common';
import type { ListParams } from '../api/common';

/**
 * Controller for provider configuration management with decorator-based routing
 */
@injectable()
@JsonController('/api/providers')
export class ProviderController {
  constructor(@inject(ProviderService) private readonly providerService: ProviderService) {}

  /**
   * POST /api/providers
   * Create a new provider
   */
  @RequirePermissions([PERMISSIONS.PROVIDER_WRITE])
  @OpenAPI({
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
  })
  @Post('/')
  @HttpCode(201)
  async createProvider(@Validated(createProviderSchema) @Body() body: CreateProviderRequest, @Req() req: Request) {
    const provider = await this.providerService.createProvider(body, req.context);
    return provider;
  }

  /**
   * GET /api/providers/:id
   * Get a provider by ID
   */
  @RequirePermissions([PERMISSIONS.PROVIDER_READ])
  @OpenAPI({
    tags: ['Providers'],
    summary: 'Get provider by ID',
    description: 'Retrieves a single provider configuration by its unique identifier',
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
  })
  @Get('/:id')
  async getProviderById(@Param('id') id: string, @Req() req: Request) {
    const provider = await this.providerService.getProviderById(id, req.context);
    return provider;
  }

  /**
   * GET /api/providers
   * List providers with optional filters
   */
  @RequirePermissions([PERMISSIONS.PROVIDER_READ])
  @OpenAPI({
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
  })
  @Get('/')
  async listProviders(@Validated(listParamsSchema, 'query') @QueryParams() query: ListParams, @Req() req: Request) {
    return await this.providerService.listProviders(query, req.context);
  }

  /**
   * PUT /api/providers/:id
   * Update a provider
   */
  @RequirePermissions([PERMISSIONS.PROVIDER_WRITE])
  @OpenAPI({
    tags: ['Providers'],
    summary: 'Update provider',
    description: 'Updates an existing provider configuration with optimistic locking',
    request: {
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
  })
  @Put('/:id')
  async updateProvider(@Param('id') id: string, @Validated(updateProviderBodySchema) @Body() body: UpdateProviderRequest, @Req() req: Request) {
    const { version, ...updateData } = body;
    const provider = await this.providerService.updateProvider(id, updateData, version, req.context);
    return provider;
  }

  /**
   * DELETE /api/providers/:id
   * Delete a provider
   */
  @RequirePermissions([PERMISSIONS.PROVIDER_DELETE])
  @OpenAPI({
    tags: ['Providers'],
    summary: 'Delete provider',
    description: 'Deletes a provider configuration with optimistic locking',
    request: {
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
  })
  @Delete('/:id')
  @HttpCode(204)
  async deleteProvider(@Param('id') id: string, @Validated(deleteProviderBodySchema) @Body() body: DeleteProviderRequest, @Req() req: Request) {
    const { version } = body;
    await this.providerService.deleteProvider(id, version, req.context);
  }

  /**
   * GET /api/providers/:id/audit-logs
   * Get audit logs for a provider
   */
  @RequirePermissions([PERMISSIONS.AUDIT_READ])
  @OpenAPI({
    tags: ['Providers'],
    summary: 'Get provider audit logs',
    description: 'Retrieves audit logs for a specific provider configuration',
    responses: {
      200: {
        description: 'Audit logs retrieved successfully',
      },
      404: { description: 'Provider not found' },
    },
  })
  @Get('/:id/audit-logs')
  async getProviderAuditLogs(@Param('id') id: string, @Req() req: Request) {
    return await this.providerService.getProviderAuditLogs(id, req.context);
  }
}

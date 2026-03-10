import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { GuardrailService } from '../../services/GuardrailService';
import { createGuardrailSchema, updateGuardrailBodySchema, deleteGuardrailBodySchema, guardrailResponseSchema, guardrailListResponseSchema, guardrailRouteParamsSchema, cloneGuardrailSchema } from '../contracts/guardrail';
import type { CreateGuardrailRequest, UpdateGuardrailRequest, DeleteGuardrailRequest, CloneGuardrailRequest } from '../contracts/guardrail';
import { listParamsSchema, projectScopedParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for guardrail management with explicit routing.
 * Guardrails are always-on behavior control actions that fire on every stage
 * regardless of stage configuration. They use a project-level classifier defined
 * via `defaultGuardrailClassifierId` on the project.
 */
@singleton()
export class GuardrailController {
  constructor(@inject(GuardrailService) private readonly guardrailService: GuardrailService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/projects/{projectId}/guardrails',
        tags: ['Guardrails'],
        summary: 'Create a new guardrail',
        description: 'Creates a new guardrail with specified name, classification trigger, and effects. Guardrails fire on every stage using the project-level classifier.',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createGuardrailSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Guardrail created successfully',
            content: {
              'application/json': {
                schema: guardrailResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'Guardrail already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/guardrails/{id}',
        tags: ['Guardrails'],
        summary: 'Get guardrail by ID',
        description: 'Retrieves a single guardrail by its unique identifier',
        request: {
          params: guardrailRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Guardrail retrieved successfully',
            content: {
              'application/json': {
                schema: guardrailResponseSchema,
              },
            },
          },
          404: { description: 'Guardrail not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/guardrails',
        tags: ['Guardrails'],
        summary: 'List guardrails',
        description: 'Retrieves a paginated list of guardrails with optional filtering and sorting',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of guardrails retrieved successfully',
            content: {
              'application/json': {
                schema: guardrailListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/projects/{projectId}/guardrails/{id}',
        tags: ['Guardrails'],
        summary: 'Update guardrail',
        description: 'Updates an existing guardrail with optimistic locking',
        request: {
          params: guardrailRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateGuardrailBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Guardrail updated successfully',
            content: {
              'application/json': {
                schema: guardrailResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Guardrail not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/guardrails/{id}',
        tags: ['Guardrails'],
        summary: 'Delete guardrail',
        description: 'Deletes a guardrail with optimistic locking',
        request: {
          params: guardrailRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteGuardrailBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Guardrail deleted successfully' },
          400: { description: 'Invalid request body' },
          404: { description: 'Guardrail not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/guardrails/{id}/audit-logs',
        tags: ['Guardrails'],
        summary: 'Get guardrail audit logs',
        description: 'Retrieves audit logs for a specific guardrail',
        request: {
          params: guardrailRouteParamsSchema,
        },
        responses: {
          200: { description: 'Audit logs retrieved successfully' },
          404: { description: 'Guardrail not found' },
        },
      },
      {
        method: 'post',
        path: '/api/projects/{projectId}/guardrails/{id}/clone',
        tags: ['Guardrails'],
        summary: 'Clone guardrail',
        description: 'Creates a copy of an existing guardrail with a new ID and optional name override',
        request: {
          params: guardrailRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: cloneGuardrailSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Guardrail cloned successfully',
            content: {
              'application/json': {
                schema: guardrailResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Guardrail not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/projects/:projectId/guardrails', asyncHandler(this.createGuardrail.bind(this)));
    router.get('/api/projects/:projectId/guardrails/:id', asyncHandler(this.getGuardrailById.bind(this)));
    router.get('/api/projects/:projectId/guardrails', asyncHandler(this.listGuardrails.bind(this)));
    router.put('/api/projects/:projectId/guardrails/:id', asyncHandler(this.updateGuardrail.bind(this)));
    router.delete('/api/projects/:projectId/guardrails/:id', asyncHandler(this.deleteGuardrail.bind(this)));
    router.get('/api/projects/:projectId/guardrails/:id/audit-logs', asyncHandler(this.getGuardrailAuditLogs.bind(this)));
    router.post('/api/projects/:projectId/guardrails/:id/clone', asyncHandler(this.cloneGuardrail.bind(this)));
  }

  /**
   * POST /api/projects/:projectId/guardrails
   * Create a new guardrail
   */
  private async createGuardrail(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.GUARDRAIL_WRITE]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const body = createGuardrailSchema.parse(req.body);
    const guardrail = await this.guardrailService.createGuardrail(projectId, body, req.context);
    res.status(201).json(guardrail);
  }

  /**
   * GET /api/projects/:projectId/guardrails/:id
   * Get a guardrail by ID
   */
  private async getGuardrailById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.GUARDRAIL_READ]);
    const params = guardrailRouteParamsSchema.parse(req.params);
    const guardrail = await this.guardrailService.getGuardrailById(params.projectId, params.id);
    res.status(200).json(guardrail);
  }

  /**
   * GET /api/projects/:projectId/guardrails
   * List guardrails with optional filters
   */
  private async listGuardrails(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.GUARDRAIL_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const guardrails = await this.guardrailService.listGuardrails(projectId, query);
    res.status(200).json(guardrails);
  }

  /**
   * PUT /api/projects/:projectId/guardrails/:id
   * Update a guardrail
   */
  private async updateGuardrail(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.GUARDRAIL_WRITE]);
    const params = guardrailRouteParamsSchema.parse(req.params);
    const body = updateGuardrailBodySchema.parse(req.body);
    const guardrail = await this.guardrailService.updateGuardrail(params.projectId, params.id, body, req.context);
    res.status(200).json(guardrail);
  }

  /**
   * DELETE /api/projects/:projectId/guardrails/:id
   * Delete a guardrail
   */
  private async deleteGuardrail(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.GUARDRAIL_DELETE]);
    const params = guardrailRouteParamsSchema.parse(req.params);
    const body = deleteGuardrailBodySchema.parse(req.body);
    await this.guardrailService.deleteGuardrail(params.projectId, params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/projects/:projectId/guardrails/:id/audit-logs
   * Get audit logs for a guardrail
   */
  private async getGuardrailAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = guardrailRouteParamsSchema.parse(req.params);
    const logs = await this.guardrailService.getGuardrailAuditLogs(params.id);
    res.status(200).json(logs);
  }

  /**
   * POST /api/projects/:projectId/guardrails/:id/clone
   * Clone a guardrail
   */
  private async cloneGuardrail(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.GUARDRAIL_WRITE]);
    const params = guardrailRouteParamsSchema.parse(req.params);
    const body = cloneGuardrailSchema.parse(req.body);
    const guardrail = await this.guardrailService.cloneGuardrail(params.projectId, params.id, body, req.context);
    res.status(201).json(guardrail);
  }
}

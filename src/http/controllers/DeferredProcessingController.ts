import { z } from 'zod';
import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { DeferredProcessingService } from '../../services/DeferredProcessingService';
import {
  deferredProcessingResponseSchema,
  deferredProcessingListResponseSchema,
  deferredProcessingRouteParamsSchema,
  deferredProcessingListParamsSchema,
  rescheduleDeferredProcessingBodySchema,
  cancelDeferredProcessingBodySchema,
} from '../contracts/deferredProcessing';
import { projectScopedParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';
import { NotFoundError } from '../../errors';

/**
 * Controller for deferred processing queue management.
 * Exposes the deferred processing queue for observability and manual control.
 */
@singleton()
export class DeferredProcessingController {
  constructor(
    @inject(DeferredProcessingService) private readonly deferredProcessingService: DeferredProcessingService,
  ) {}

  /**
   * Register Express routes for deferred processing endpoints
   */
  public registerRoutes(router: Router): void {
    router.get(
      '/api/projects/:projectId/deferred-processing',
      asyncHandler(this.handleList.bind(this)),
    );
    router.get(
      '/api/projects/:projectId/deferred-processing/:id',
      asyncHandler(this.handleGetById.bind(this)),
    );
    router.post(
      '/api/projects/:projectId/deferred-processing/:id/reschedule',
      asyncHandler(this.handleReschedule.bind(this)),
    );
    router.post(
      '/api/projects/:projectId/deferred-processing/:id/cancel',
      asyncHandler(this.handleCancel.bind(this)),
    );
  }

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    const deferredProcessingIdParamSchema = z.object({
      projectId: projectScopedParamsSchema.shape.projectId,
      id: deferredProcessingRouteParamsSchema.shape.id,
    });

    return [
      {
        method: 'get',
        path: '/api/projects/{projectId}/deferred-processing',
        tags: ['Deferred Processing'],
        summary: 'List deferred processing entries',
        description: 'Lists deferred processing queue entries for a project. Supports filtering by status, conversation, and channel type.',
        request: {
          query: deferredProcessingListParamsSchema,
        },
        responses: {
          200: {
            description: 'Deferred processing entries listed',
            content: {
              'application/json': {
                schema: deferredProcessingListResponseSchema,
              },
            },
          },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/deferred-processing/{id}',
        tags: ['Deferred Processing'],
        summary: 'Get a deferred processing entry',
        description: 'Retrieves a single deferred processing entry by ID.',
        request: {
          params: deferredProcessingIdParamSchema,
        },
        responses: {
          200: {
            description: 'Deferred processing entry details',
            content: {
              'application/json': {
                schema: deferredProcessingResponseSchema,
              },
            },
          },
          404: { description: 'Entry not found' },
        },
      },
      {
        method: 'post',
        path: '/api/projects/{projectId}/deferred-processing/{id}/reschedule',
        tags: ['Deferred Processing'],
        summary: 'Reschedule a deferred processing entry',
        description:
          'Changes the scheduled processing time for a pending entry. Use a past date to trigger immediate processing (next poll cycle). Max delay is 30 days from now.',
        request: {
          params: deferredProcessingIdParamSchema,
          body: {
            content: {
              'application/json': {
                schema: rescheduleDeferredProcessingBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Entry rescheduled',
            content: {
              'application/json': {
                schema: deferredProcessingResponseSchema,
              },
            },
          },
          404: { description: 'Entry not found or not pending' },
        },
      },
      {
        method: 'post',
        path: '/api/projects/{projectId}/deferred-processing/{id}/cancel',
        tags: ['Deferred Processing'],
        summary: 'Cancel a deferred processing entry',
        description: 'Cancels a pending deferred processing entry. The message will not be processed.',
        request: {
          params: deferredProcessingIdParamSchema,
          body: {
            content: {
              'application/json': {
                schema: cancelDeferredProcessingBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Entry cancelled',
            content: {
              'application/json': {
                schema: deferredProcessingResponseSchema,
              },
            },
          },
          404: { description: 'Entry not found or not pending' },
        },
      },
    ];
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  private async handleList(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROJECT_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const query = deferredProcessingListParamsSchema.parse(req.query);

    const result = await this.deferredProcessingService.list({
      projectId,
      status: query.status,
      conversationId: query.conversationId,
      channelType: query.channelType,
      offset: query.offset,
      limit: query.limit,
    });

    res.json({
      items: result.items,
      total: result.total,
      offset: query.offset,
      limit: query.limit,
    });
  }

  private async handleGetById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROJECT_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const { id } = deferredProcessingRouteParamsSchema.parse(req.params);

    const entry = await this.deferredProcessingService.getById(id);
    if (!entry || entry.projectId !== projectId) {
      throw new NotFoundError(`Deferred processing entry ${id} not found`);
    }

    res.json(entry);
  }

  private async handleReschedule(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROJECT_WRITE]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const { id } = deferredProcessingRouteParamsSchema.parse(req.params);
    const body = rescheduleDeferredProcessingBodySchema.parse(req.body);

    // Verify entry belongs to project
    const existing = await this.deferredProcessingService.getById(id);
    if (!existing || existing.projectId !== projectId) {
      throw new NotFoundError(`Deferred processing entry ${id} not found`);
    }

    await this.deferredProcessingService.reschedule(id, body.processAt);

    // Return updated entry
    const updated = await this.deferredProcessingService.getById(id);
    res.json(updated);
  }

  private async handleCancel(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROJECT_WRITE]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const { id } = deferredProcessingRouteParamsSchema.parse(req.params);

    // Verify entry belongs to project
    const existing = await this.deferredProcessingService.getById(id);
    if (!existing || existing.projectId !== projectId) {
      throw new NotFoundError(`Deferred processing entry ${id} not found`);
    }

    await this.deferredProcessingService.cancel(id);

    // Return updated entry
    const updated = await this.deferredProcessingService.getById(id);
    res.json(updated);
  }
}

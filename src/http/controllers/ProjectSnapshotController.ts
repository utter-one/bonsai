import { inject, singleton } from 'tsyringe';
import type { Request, Response, NextFunction, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { ProjectSnapshotService } from '../../services/ProjectSnapshotService';
import {
  createSnapshotSchema,
  updateSnapshotNameSchema,
  snapshotRouteParamsSchema,
  snapshotVersionRouteParamsSchema,
  listSnapshotsQuerySchema,
  compareSnapshotsQuerySchema,
  snapshotResponseSchema,
  snapshotFullResponseSchema,
  snapshotListResponseSchema,
  snapshotComparisonResponseSchema,
  snapshotRestoreResponseSchema,
  snapshotDeleteResponseSchema,
  entityCountsSchema,
  fieldChangeSchema,
  entityDiffSchema,
  addedRemovedEntitySchema,
  comparisonSummarySchema,
  restoreWarningSchema,
  schemaStatusSchema,
} from '../contracts/projectSnapshot';
import type { CreateSnapshotRequest, UpdateSnapshotNameRequest, ListSnapshotsQuery, CompareSnapshotsQuery } from '../contracts/projectSnapshot';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';
import { logger } from '../../utils/logger';

/**
 * Controller for project snapshot management.
 * All endpoints are scoped under /api/projects/:id/snapshots.
 */
@singleton()
export class ProjectSnapshotController {
  constructor(
    @inject(ProjectSnapshotService) private readonly snapshotService: ProjectSnapshotService,
  ) { }

  /**
   * Get OpenAPI path definitions for this controller.
   */
  static getOpenAPIPaths(): RouteConfig[] {
    const projectIdParamSchema = z.object({
      id: z.string().min(1).describe('Project ID'),
    });
    const snapshotIdParamSchema = z.object({
      id: z.string().min(1).describe('Project ID'),
      snapshotId: z.string().min(1).describe('Snapshot ID'),
    });
    const versionParamSchema = z.object({
      id: z.string().min(1).describe('Project ID'),
      version: z.string().min(1).describe('Snapshot version number'),
    });

    return [
      {
        method: 'post',
        path: '/api/projects/{id}/snapshots',
        tags: ['Project Snapshots'],
        summary: 'Create a new snapshot',
        description: 'Create a new snapshot of the project at the current point in time. Version number is auto-incremented.',
        request: {
          params: projectIdParamSchema,
          body: {
            content: {
              'application/json': {
                schema: createSnapshotSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Snapshot created successfully',
            content: {
              'application/json': {
                schema: snapshotResponseSchema,
              },
            },
          },
          403: { description: 'Insufficient permissions' },
          404: { description: 'Project not found' },
          409: { description: 'Project is archived or snapshot limit reached' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{id}/snapshots',
        tags: ['Project Snapshots'],
        summary: 'List snapshots',
        description: 'List all snapshots for a project, ordered by version descending.',
        request: {
          params: projectIdParamSchema,
          query: listSnapshotsQuerySchema,
        },
        responses: {
          200: {
            description: 'Snapshots retrieved successfully',
            content: {
              'application/json': {
                schema: snapshotListResponseSchema,
              },
            },
          },
          404: { description: 'Project not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{id}/snapshots/{snapshotId}',
        tags: ['Project Snapshots'],
        summary: 'Get snapshot',
        description: 'Retrieve a single snapshot with its full entity data.',
        request: {
          params: snapshotIdParamSchema,
        },
        responses: {
          200: {
            description: 'Snapshot retrieved successfully',
            content: {
              'application/json': {
                schema: snapshotFullResponseSchema,
              },
            },
          },
          404: { description: 'Snapshot not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{id}/snapshots/version/{version}',
        tags: ['Project Snapshots'],
        summary: 'Get snapshot by version',
        description: 'Retrieve a snapshot by its sequential version number.',
        request: {
          params: versionParamSchema,
        },
        responses: {
          200: {
            description: 'Snapshot retrieved successfully',
            content: {
              'application/json': {
                schema: snapshotFullResponseSchema,
              },
            },
          },
          404: { description: 'Snapshot version not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{id}/snapshots/compare',
        tags: ['Project Snapshots'],
        summary: 'Compare snapshots',
        description: 'Compare two snapshots and return a structured diff.',
        request: {
          params: projectIdParamSchema,
          query: compareSnapshotsQuerySchema,
        },
        responses: {
          200: {
            description: 'Comparison result',
            content: {
              'application/json': {
                schema: snapshotComparisonResponseSchema,
              },
            },
          },
          400: { description: 'Invalid comparison parameters' },
          404: { description: 'Project or snapshot version not found' },
        },
      },
      {
        method: 'patch',
        path: '/api/projects/{id}/snapshots/{snapshotId}',
        tags: ['Project Snapshots'],
        summary: 'Update snapshot name',
        description: 'Update the human-readable name of an existing snapshot.',
        request: {
          params: snapshotIdParamSchema,
          body: {
            content: {
              'application/json': {
                schema: updateSnapshotNameSchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Snapshot name updated',
            content: {
              'application/json': {
                schema: snapshotResponseSchema,
              },
            },
          },
          404: { description: 'Snapshot not found' },
        },
      },
      {
        method: 'post',
        path: '/api/projects/{id}/snapshots/{snapshotId}/restore',
        tags: ['Project Snapshots'],
        summary: 'Restore from snapshot',
        description: 'Restore a project\'s configuration to match a previous snapshot. A backup snapshot is automatically created before restore.',
        request: {
          params: snapshotIdParamSchema,
        },
        responses: {
          200: {
            description: 'Project restored successfully',
            content: {
              'application/json': {
                schema: snapshotRestoreResponseSchema,
              },
            },
          },
          400: { description: 'Snapshot cannot be migrated' },
          404: { description: 'Snapshot not found' },
          409: { description: 'Project is archived' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{id}/snapshots/{snapshotId}',
        tags: ['Project Snapshots'],
        summary: 'Delete snapshot',
        description: 'Delete a single snapshot.',
        request: {
          params: snapshotIdParamSchema,
        },
        responses: {
          200: {
            description: 'Snapshot deleted',
            content: {
              'application/json': {
                schema: snapshotDeleteResponseSchema,
              },
            },
          },
          404: { description: 'Snapshot not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller.
   */
  registerRoutes(router: Router): void {
    router.post('/api/projects/:id/snapshots', asyncHandler(this.createSnapshot.bind(this)));
    router.get('/api/projects/:id/snapshots', asyncHandler(this.listSnapshots.bind(this)));
    router.get('/api/projects/:id/snapshots/compare', asyncHandler(this.compareSnapshots.bind(this)));
    router.get('/api/projects/:id/snapshots/version/:version', asyncHandler(this.getSnapshotByVersion.bind(this)));
    router.get('/api/projects/:id/snapshots/:snapshotId', asyncHandler(this.getSnapshot.bind(this)));
    router.patch('/api/projects/:id/snapshots/:snapshotId', asyncHandler(this.updateSnapshotName.bind(this)));
    router.post('/api/projects/:id/snapshots/:snapshotId/restore', asyncHandler(this.restoreSnapshot.bind(this)));
    router.delete('/api/projects/:id/snapshots/:snapshotId', asyncHandler(this.deleteSnapshot.bind(this)));
  }

  /**
   * POST /api/projects/:id/snapshots
   */
  private async createSnapshot(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROJECT_WRITE]);
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = createSnapshotSchema.parse(req.body || {});
    const snapshot = await this.snapshotService.createSnapshot(params.id, body as CreateSnapshotRequest, req.context);
    res.status(201).json(snapshot);
  }

  /**
   * GET /api/projects/:id/snapshots
   */
  private async listSnapshots(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROJECT_READ]);
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const query = listSnapshotsQuerySchema.parse(req.query);
    const result = await this.snapshotService.listSnapshots(params.id, query as ListSnapshotsQuery, req.context);
    res.status(200).json(result);
  }

  /**
   * GET /api/projects/:id/snapshots/:snapshotId
   */
  private async getSnapshot(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROJECT_READ]);
    const params = snapshotRouteParamsSchema.parse(req.params);
    const snapshot = await this.snapshotService.getSnapshot(params.id, params.snapshotId, req.context);
    res.status(200).json(snapshot);
  }

  /**
   * GET /api/projects/:id/snapshots/version/:version
   */
  private async getSnapshotByVersion(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROJECT_READ]);
    const params = z.object({ id: z.string().min(1), version: z.coerce.number().int().positive() }).parse(req.params);
    const snapshot = await this.snapshotService.getSnapshotByVersion(params.id, params.version, req.context);
    res.status(200).json(snapshot);
  }

  /**
   * GET /api/projects/:id/snapshots/compare
   */
  private async compareSnapshots(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROJECT_READ]);
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const query = compareSnapshotsQuerySchema.parse(req.query);
    const result = await this.snapshotService.compareSnapshots(params.id, query.fromVersion, query.toVersion, req.context);
    res.status(200).json(result);
  }

  /**
   * PATCH /api/projects/:id/snapshots/:snapshotId
   */
  private async updateSnapshotName(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROJECT_WRITE]);
    const params = snapshotRouteParamsSchema.parse(req.params);
    const body = updateSnapshotNameSchema.parse(req.body || {});
    const snapshot = await this.snapshotService.updateSnapshotName(params.id, params.snapshotId, body as UpdateSnapshotNameRequest, req.context);
    res.status(200).json(snapshot);
  }

  /**
   * POST /api/projects/:id/snapshots/:snapshotId/restore
   */
  private async restoreSnapshot(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROJECT_WRITE]);
    const params = snapshotRouteParamsSchema.parse(req.params);
    const result = await this.snapshotService.restoreSnapshot(params.id, params.snapshotId, req.context);
    res.status(200).json(result);
  }

  /**
   * DELETE /api/projects/:id/snapshots/:snapshotId
   */
  private async deleteSnapshot(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROJECT_WRITE]);
    const params = snapshotRouteParamsSchema.parse(req.params);
    const result = await this.snapshotService.deleteSnapshot(params.id, params.snapshotId, req.context);
    res.status(200).json(result);
  }
}

// Import z for route param schemas in getOpenAPIPaths
import { z } from 'zod';

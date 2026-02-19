import { inject, singleton } from 'tsyringe';
import type { Request, Response, NextFunction, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { ClassifierService } from '../../services/ClassifierService';
import { createClassifierSchema, updateClassifierBodySchema, deleteClassifierBodySchema, classifierResponseSchema, classifierListResponseSchema, classifierRouteParamsSchema, cloneClassifierSchema } from '../contracts/classifier';
import type { CloneClassifierRequest } from '../contracts/classifier';
import { listParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for classifier management with explicit routing
 */
@singleton()
export class ClassifierController {
  constructor(@inject(ClassifierService) private readonly classifierService: ClassifierService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/classifiers',
        tags: ['Classifiers'],
        summary: 'Create a new classifier',
        description: 'Creates a new classifier with specified name, prompt, and configuration',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createClassifierSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Classifier created successfully',
            content: {
              'application/json': {
                schema: classifierResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'Classifier already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/classifiers/{id}',
        tags: ['Classifiers'],
        summary: 'Get classifier by ID',
        description: 'Retrieves a single classifier by its unique identifier',
        request: {
          params: classifierRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Classifier retrieved successfully',
            content: {
              'application/json': {
                schema: classifierResponseSchema,
              },
            },
          },
          404: { description: 'Classifier not found' },
        },
      },
      {
        method: 'get',
        path: '/api/classifiers',
        tags: ['Classifiers'],
        summary: 'List classifiers',
        description: 'Retrieves a paginated list of classifiers with optional filtering and sorting',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of classifiers retrieved successfully',
            content: {
              'application/json': {
                schema: classifierListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/classifiers/{id}',
        tags: ['Classifiers'],
        summary: 'Update classifier',
        description: 'Updates an existing classifier with optimistic locking',
        request: {
          params: classifierRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateClassifierBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Classifier updated successfully',
            content: {
              'application/json': {
                schema: classifierResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Classifier not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'delete',
        path: '/api/classifiers/{id}',
        tags: ['Classifiers'],
        summary: 'Delete classifier',
        description: 'Deletes a classifier with optimistic locking',
        request: {
          params: classifierRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteClassifierBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Classifier deleted successfully' },
          400: { description: 'Invalid request body' },
          404: { description: 'Classifier not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'get',
        path: '/api/classifiers/{id}/audit-logs',
        tags: ['Classifiers'],
        summary: 'Get classifier audit logs',
        description: 'Retrieves audit logs for a specific classifier',
        request: {
          params: classifierRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Classifier not found' },
        },
      },
      {
        method: 'post',
        path: '/api/classifiers/{id}/clone',
        tags: ['Classifiers'],
        summary: 'Clone classifier',
        description: 'Creates a copy of an existing classifier with a new ID and optional name override',
        request: {
          params: classifierRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: cloneClassifierSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Classifier cloned successfully',
            content: {
              'application/json': {
                schema: classifierResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Classifier not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/classifiers', asyncHandler(this.createClassifier.bind(this)));
    router.get('/api/classifiers/:id', asyncHandler(this.getClassifierById.bind(this)));
    router.get('/api/classifiers', asyncHandler(this.listClassifiers.bind(this)));
    router.put('/api/classifiers/:id', asyncHandler(this.updateClassifier.bind(this)));
    router.delete('/api/classifiers/:id', asyncHandler(this.deleteClassifier.bind(this)));
    router.get('/api/classifiers/:id/audit-logs', asyncHandler(this.getClassifierAuditLogs.bind(this)));
    router.post('/api/classifiers/:id/clone', asyncHandler(this.cloneClassifier.bind(this)));
  }

  /**
   * POST /api/classifiers
   * Create a new classifier
   */
  private async createClassifier(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.CLASSIFIER_WRITE]);
    const body = createClassifierSchema.parse(req.body);
    const classifier = await this.classifierService.createClassifier(body, req.context);
    res.status(201).json(classifier);
  }

  /**
   * GET /api/classifiers/:id
   * Get a classifier by ID
   */
  private async getClassifierById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.CLASSIFIER_READ]);
    const params = classifierRouteParamsSchema.parse(req.params);
    const classifier = await this.classifierService.getClassifierById(params.id);
    res.status(200).json(classifier);
  }

  /**
   * GET /api/classifiers
   * List classifiers with optional filters
   */
  private async listClassifiers(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.CLASSIFIER_READ]);
    const query = listParamsSchema.parse(req.query);
    const classifiers = await this.classifierService.listClassifiers(query);
    res.status(200).json(classifiers);
  }

  /**
   * PUT /api/classifiers/:id
   * Update a classifier
   */
  private async updateClassifier(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.CLASSIFIER_WRITE]);
    const params = classifierRouteParamsSchema.parse(req.params);
    const body = updateClassifierBodySchema.parse(req.body);
    const classifier = await this.classifierService.updateClassifier(params.id, body, req.context);
    res.status(200).json(classifier);
  }

  /**
   * DELETE /api/classifiers/:id
   * Delete a classifier
   */
  private async deleteClassifier(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.CLASSIFIER_DELETE]);
    const params = classifierRouteParamsSchema.parse(req.params);
    const body = deleteClassifierBodySchema.parse(req.body);
    await this.classifierService.deleteClassifier(params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/classifiers/:id/audit-logs
   * Get audit logs for a classifier
   */
  private async getClassifierAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = classifierRouteParamsSchema.parse(req.params);
    const auditLogs = await this.classifierService.getClassifierAuditLogs(params.id);
    res.status(200).json(auditLogs);
  }

  /**
   * POST /api/classifiers/:id/clone
   * Clone a classifier
   */
  private async cloneClassifier(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.CLASSIFIER_WRITE]);
    const params = classifierRouteParamsSchema.parse(req.params);
    const body = cloneClassifierSchema.parse(req.body);
    const classifier = await this.classifierService.cloneClassifier(params.id, body, req.context);
    res.status(201).json(classifier);
  }
}

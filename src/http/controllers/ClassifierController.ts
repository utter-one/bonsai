import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, Body, QueryParams, HttpCode, Req } from 'routing-controllers';
import { injectable, inject } from 'tsyringe';
import { Validated } from '../decorators/validation';
import { OpenAPI } from '../decorators/openapi';
import { RequirePermissions } from '../decorators/auth';
import { PERMISSIONS } from '../../permissions';
import type { Request } from 'express';
import { ClassifierService } from '../../services/ClassifierService';
import { createClassifierSchema, updateClassifierBodySchema, deleteClassifierBodySchema, classifierResponseSchema, classifierListResponseSchema } from '../contracts/classifier';
import type { CreateClassifierRequest, UpdateClassifierRequest, DeleteClassifierRequest } from '../contracts/classifier';
import { listParamsSchema } from '../contracts/common';
import type { ListParams } from '../contracts/common';

/**
 * Controller for classifier management with decorator-based routing
 * Manages classifiers which categorize or classify user inputs in conversations
 */
@injectable()
@JsonController('/api/classifiers')
export class ClassifierController {
  constructor(@inject(ClassifierService) private readonly classifierService: ClassifierService) {}

  /**
   * POST /api/classifiers
   * Create a new classifier
   */
  @RequirePermissions([PERMISSIONS.CLASSIFIER_WRITE])
  @OpenAPI({
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
  })
  @Post('/')
  @HttpCode(201)
  async createClassifier(@Validated(createClassifierSchema) @Body() body: CreateClassifierRequest, @Req() req: Request) {
    const classifier = await this.classifierService.createClassifier(body, req.context);
    return classifier;
  }

  /**
   * GET /api/classifiers/:id
   * Get a classifier by ID
   */
  @RequirePermissions([PERMISSIONS.CLASSIFIER_READ])
  @OpenAPI({
    tags: ['Classifiers'],
    summary: 'Get classifier by ID',
    description: 'Retrieves a single classifier by its unique identifier',
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
  })
  @Get('/:id')
  async getClassifierById(@Param('id') id: string) {
    const classifier = await this.classifierService.getClassifierById(id);
    return classifier;
  }

  /**
   * GET /api/classifiers
   * List classifiers with optional filters
   */
  @RequirePermissions([PERMISSIONS.CLASSIFIER_READ])
  @OpenAPI({
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
  })
  @Get('/')
  async listClassifiers(@Validated(listParamsSchema, 'query') @QueryParams() query: ListParams) {
    return await this.classifierService.listClassifiers(query);
  }

  /**
   * PUT /api/classifiers/:id
   * Update a classifier
   */
  @RequirePermissions([PERMISSIONS.CLASSIFIER_WRITE])
  @OpenAPI({
    tags: ['Classifiers'],
    summary: 'Update classifier',
    description: 'Updates an existing classifier with optimistic locking',
    request: {
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
  })
  @Put('/:id')
  async updateClassifier(@Param('id') id: string, @Validated(updateClassifierBodySchema) @Body() body: UpdateClassifierRequest, @Req() req: Request) {
    const { version, ...updateData } = body;
    const classifier = await this.classifierService.updateClassifier(id, updateData, version, req.context);
    return classifier;
  }

  /**
   * DELETE /api/classifiers/:id
   * Delete a classifier
   */
  @RequirePermissions([PERMISSIONS.CLASSIFIER_DELETE])
  @OpenAPI({
    tags: ['Classifiers'],
    summary: 'Delete classifier',
    description: 'Deletes a classifier with optimistic locking',
    request: {
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
  })
  @Delete('/:id')
  @HttpCode(204)
  async deleteClassifier(@Param('id') id: string, @Validated(deleteClassifierBodySchema) @Body() body: DeleteClassifierRequest, @Req() req: Request) {
    await this.classifierService.deleteClassifier(id, body.version, req.context);
  }

  /**
   * GET /api/classifiers/:id/audit-logs
   * Get audit logs for a classifier
   */
  @RequirePermissions([PERMISSIONS.AUDIT_READ])
  @OpenAPI({
    tags: ['Classifiers'],
    summary: 'Get classifier audit logs',
    description: 'Retrieves audit logs for a specific classifier',
    responses: {
      200: {
        description: 'Audit logs retrieved successfully',
      },
      404: { description: 'Classifier not found' },
    },
  })
  @Get('/:id/audit-logs')
  async getClassifierAuditLogs(@Param('id') id: string) {
    return await this.classifierService.getClassifierAuditLogs(id);
  }
}

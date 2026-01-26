import { inject, singleton } from 'tsyringe';
import type { Request, Response, NextFunction, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { ProjectService } from '../../services/ProjectService';
import { createProjectSchema, updateProjectSchema, projectRouteParamsSchema, projectResponseSchema, projectListResponseSchema } from '../contracts/project';
import type { UpdateProjectRequest } from '../contracts/project';
import { listParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for project management with explicit routing
 */
@singleton()
export class ProjectController {
  constructor(@inject(ProjectService) private readonly projectService: ProjectService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    const projectIdParamSchema = projectRouteParamsSchema;

    return [
      {
        method: 'post',
        path: '/api/projects',
        tags: ['Projects'],
        summary: 'Create a new project',
        description: 'Creates a new project that groups stages, personas, classifiers, context transformers, tools, knowledge, actions, and issues',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createProjectSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Project created successfully',
            content: {
              'application/json': {
                schema: projectResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'Project already exists' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{id}',
        tags: ['Projects'],
        summary: 'Get project by ID',
        description: 'Retrieves a single project by its unique identifier',
        request: {
          params: projectIdParamSchema,
        },
        responses: {
          200: {
            description: 'Project retrieved successfully',
            content: {
              'application/json': {
                schema: projectResponseSchema,
              },
            },
          },
          404: { description: 'Project not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects',
        tags: ['Projects'],
        summary: 'List projects',
        description: 'Retrieves a paginated list of projects with optional filtering, sorting, and searching',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'Projects retrieved successfully',
            content: {
              'application/json': {
                schema: projectListResponseSchema,
              },
            },
          },
        },
      },
      {
        method: 'put',
        path: '/api/projects/{id}',
        tags: ['Projects'],
        summary: 'Update project',
        description: 'Updates an existing project with optimistic locking support',
        request: {
          params: projectIdParamSchema,
          body: {
            content: {
              'application/json': {
                schema: updateProjectSchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Project updated successfully',
            content: {
              'application/json': {
                schema: projectResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Project not found' },
          409: { description: 'Version conflict (optimistic locking)' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{id}',
        tags: ['Projects'],
        summary: 'Delete project',
        description: 'Deletes a project and all its associated entities',
        request: {
          params: projectIdParamSchema,
        },
        responses: {
          204: { description: 'Project deleted successfully' },
          404: { description: 'Project not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/projects', asyncHandler(this.createProject.bind(this)));
    router.get('/api/projects/:id', asyncHandler(this.getProjectById.bind(this)));
    router.get('/api/projects', asyncHandler(this.listProjects.bind(this)));
    router.put('/api/projects/:id', asyncHandler(this.updateProject.bind(this)));
    router.delete('/api/projects/:id', asyncHandler(this.deleteProject.bind(this)));
  }

  /**
   * POST /api/projects
   * Create a new project
   */
  private async createProject(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROJECT_WRITE]);
    const body = createProjectSchema.parse(req.body);
    const project = await this.projectService.createProject(body, req.context);
    res.status(201).json(project);
  }

  /**
   * GET /api/projects/:id
   * Get a project by ID
   */
  private async getProjectById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROJECT_READ]);
    const params = projectRouteParamsSchema.parse(req.params);
    const project = await this.projectService.getProjectById(params.id);
    res.status(200).json(project);
  }

  /**
   * GET /api/projects
   * List projects with optional filters
   */
  private async listProjects(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROJECT_READ]);
    const query = listParamsSchema.parse(req.query);
    const projects = await this.projectService.listProjects(query);
    res.status(200).json(projects);
  }

  /**
   * PUT /api/projects/:id
   * Update a project
   */
  private async updateProject(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROJECT_WRITE]);
    const params = projectRouteParamsSchema.parse(req.params);
    const body = updateProjectSchema.parse(req.body);
    const project = await this.projectService.updateProject(params.id, body as UpdateProjectRequest & { version: number }, req.context);
    res.status(200).json(project);
  }

  /**
   * DELETE /api/projects/:id
   * Delete a project
   */
  private async deleteProject(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.PROJECT_DELETE]);
    const params = projectRouteParamsSchema.parse(req.params);
    await this.projectService.deleteProject(params.id, req.context);
    res.status(204).send();
  }
}

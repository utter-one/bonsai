import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, Body, QueryParams, HttpCode, Req } from 'routing-controllers';
import { injectable, inject } from 'tsyringe';
import { Validated } from '../decorators/validation';
import { OpenAPI } from '../decorators/openapi';
import { RequirePermissions } from '../decorators/auth';
import { PERMISSIONS } from '../../permissions';
import type { Request } from 'express';
import { ProjectService } from '../../services/ProjectService';
import { createProjectSchema, updateProjectSchema, projectResponseSchema, projectListResponseSchema, projectRouteParamsSchema } from '../contracts/project';
import type { CreateProjectRequest, UpdateProjectRequest, ProjectRouteParams } from '../contracts/project';
import { listParamsSchema } from '../contracts/common';
import type { ListParams } from '../contracts/common';

/**
 * Controller for project management with decorator-based routing
 */
@injectable()
@JsonController('/api/projects')
export class ProjectController {
  constructor(@inject(ProjectService) private readonly projectService: ProjectService) {}

  /**
   * POST /api/projects
   * Create a new project
   */
  @RequirePermissions([PERMISSIONS.PROJECT_WRITE])
  @OpenAPI({
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
  })
  @Post('/')
  @HttpCode(201)
  async createProject(@Validated(createProjectSchema) @Body() body: CreateProjectRequest, @Req() req: Request) {
    const project = await this.projectService.createProject(body, req.context);
    return project;
  }

  /**
   * GET /api/projects/:id
   * Get a project by ID
   */
  @RequirePermissions([PERMISSIONS.PROJECT_READ])
  @OpenAPI({
    tags: ['Projects'],
    summary: 'Get project by ID',
    description: 'Retrieves a single project by its unique identifier',
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
  })
  @Get('/:id')
  async getProjectById(@Validated(projectRouteParamsSchema, 'params') @Param('id') id: string) {
    const project = await this.projectService.getProjectById(id);
    return project;
  }

  /**
   * GET /api/projects
   * List projects with optional filters
   */
  @RequirePermissions([PERMISSIONS.PROJECT_READ])
  @OpenAPI({
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
  })
  @Get('/')
  async listProjects(@Validated(listParamsSchema, 'query') @QueryParams() query: ListParams) {
    const projects = await this.projectService.listProjects(query);
    return projects;
  }

  /**
   * PUT /api/projects/:id
   * Update a project
   */
  @RequirePermissions([PERMISSIONS.PROJECT_WRITE])
  @OpenAPI({
    tags: ['Projects'],
    summary: 'Update project',
    description: 'Updates an existing project with optimistic locking support',
    request: {
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
  })
  @Put('/:id')
  async updateProject(@Validated(projectRouteParamsSchema, 'params') @Param('id') id: string, @Validated(updateProjectSchema) @Body() body: UpdateProjectRequest & { version: number }, @Req() req: Request) {
    const project = await this.projectService.updateProject(id, body, req.context);
    return project;
  }

  /**
   * DELETE /api/projects/:id
   * Delete a project
   */
  @RequirePermissions([PERMISSIONS.PROJECT_DELETE])
  @OpenAPI({
    tags: ['Projects'],
    summary: 'Delete project',
    description: 'Deletes a project and all its associated entities',
    responses: {
      204: { description: 'Project deleted successfully' },
      404: { description: 'Project not found' },
    },
  })
  @Delete('/:id')
  @HttpCode(204)
  async deleteProject(@Validated(projectRouteParamsSchema, 'params') @Param('id') id: string, @Req() req: Request) {
    await this.projectService.deleteProject(id, req.context);
  }
}

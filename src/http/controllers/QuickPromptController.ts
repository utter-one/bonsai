import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { QuickPromptService } from '../../services/QuickPromptService';
import {
  createQuickPromptSchema,
  createProjectQuickPromptSchema,
  updateQuickPromptBodySchema,
  deleteQuickPromptBodySchema,
  cloneQuickPromptSchema,
  quickPromptResponseSchema,
  quickPromptListResponseSchema,
  quickPromptRouteParamsSchema,
  quickPromptProjectRouteParamsSchema,
} from '../contracts/quickPrompt';
import type {
  CreateQuickPromptRequest,
  CreateProjectQuickPromptRequest,
  UpdateQuickPromptRequest,
  DeleteQuickPromptRequest,
  CloneQuickPromptRequest,
} from '../contracts/quickPrompt';
import { listParamsSchema, projectScopedParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

@singleton()
export class QuickPromptController {
  constructor(@inject(QuickPromptService) private readonly quickPromptService: QuickPromptService) { }

  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/quick-prompts',
        tags: ['Quick Prompts'],
        summary: 'Create a global quick prompt',
        description: 'Creates a new global quick prompt template',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createQuickPromptSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Quick prompt created successfully',
            content: {
              'application/json': {
                schema: quickPromptResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
        },
      },
      {
        method: 'get',
        path: '/api/quick-prompts/{id}',
        tags: ['Quick Prompts'],
        summary: 'Get a global quick prompt by ID',
        description: 'Retrieves a single global quick prompt by its unique identifier',
        request: {
          params: quickPromptRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Quick prompt retrieved successfully',
            content: {
              'application/json': {
                schema: quickPromptResponseSchema,
              },
            },
          },
          404: { description: 'Quick prompt not found' },
        },
      },
      {
        method: 'get',
        path: '/api/quick-prompts',
        tags: ['Quick Prompts'],
        summary: 'List global quick prompts',
        description: 'Retrieves a paginated list of global quick prompts with optional filtering',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of quick prompts retrieved successfully',
            content: {
              'application/json': {
                schema: quickPromptListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/quick-prompts/{id}',
        tags: ['Quick Prompts'],
        summary: 'Update a quick prompt',
        description: 'Updates an existing quick prompt with optimistic locking',
        request: {
          params: quickPromptRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateQuickPromptBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Quick prompt updated successfully',
            content: {
              'application/json': {
                schema: quickPromptResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Quick prompt not found' },
          409: { description: 'Version conflict' },
        },
      },
      {
        method: 'delete',
        path: '/api/quick-prompts/{id}',
        tags: ['Quick Prompts'],
        summary: 'Delete a quick prompt',
        description: 'Deletes a quick prompt with optimistic locking. System prompts cannot be deleted.',
        request: {
          params: quickPromptRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteQuickPromptBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Quick prompt deleted successfully' },
          400: { description: 'Invalid request body' },
          403: { description: 'Cannot delete system prompts' },
          404: { description: 'Quick prompt not found' },
          409: { description: 'Version conflict' },
        },
      },
      {
        method: 'post',
        path: '/api/quick-prompts/{id}/clone',
        tags: ['Quick Prompts'],
        summary: 'Clone a quick prompt',
        description: 'Creates a copy of an existing quick prompt',
        request: {
          params: quickPromptRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: cloneQuickPromptSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Quick prompt cloned successfully',
            content: {
              'application/json': {
                schema: quickPromptResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Quick prompt not found' },
        },
      },
      {
        method: 'post',
        path: '/api/projects/{projectId}/quick-prompts',
        tags: ['Quick Prompts'],
        summary: 'Create a project-scoped quick prompt',
        description: 'Creates a new quick prompt scoped to a specific project',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createProjectQuickPromptSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Project quick prompt created successfully',
            content: {
              'application/json': {
                schema: quickPromptResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/quick-prompts/{id}',
        tags: ['Quick Prompts'],
        summary: 'Get a project quick prompt by ID',
        description: 'Retrieves a single project-scoped quick prompt',
        request: {
          params: quickPromptProjectRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Quick prompt retrieved successfully',
            content: {
              'application/json': {
                schema: quickPromptResponseSchema,
              },
            },
          },
          404: { description: 'Quick prompt not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/quick-prompts',
        tags: ['Quick Prompts'],
        summary: 'List project quick prompts',
        description: 'Retrieves a paginated list of project-scoped quick prompts',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of project quick prompts retrieved successfully',
            content: {
              'application/json': {
                schema: quickPromptListResponseSchema,
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
      {
        method: 'put',
        path: '/api/projects/{projectId}/quick-prompts/{id}',
        tags: ['Quick Prompts'],
        summary: 'Update a project quick prompt',
        description: 'Updates an existing project-scoped quick prompt',
        request: {
          params: quickPromptProjectRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateQuickPromptBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Quick prompt updated successfully',
            content: {
              'application/json': {
                schema: quickPromptResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Quick prompt not found' },
          409: { description: 'Version conflict' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/quick-prompts/{id}',
        tags: ['Quick Prompts'],
        summary: 'Delete a project quick prompt',
        description: 'Deletes a project-scoped quick prompt',
        request: {
          params: quickPromptProjectRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteQuickPromptBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Quick prompt deleted successfully' },
          400: { description: 'Invalid request body' },
          403: { description: 'Cannot delete system prompts' },
          404: { description: 'Quick prompt not found' },
          409: { description: 'Version conflict' },
        },
      },
      {
        method: 'post',
        path: '/api/projects/{projectId}/quick-prompts/{id}/clone',
        tags: ['Quick Prompts'],
        summary: 'Clone a project quick prompt',
        description: 'Creates a copy of an existing project-scoped quick prompt',
        request: {
          params: quickPromptProjectRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: cloneQuickPromptSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Quick prompt cloned successfully',
            content: {
              'application/json': {
                schema: quickPromptResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Quick prompt not found' },
        },
      },
    ];
  }

  registerRoutes(router: Router): void {
    router.post('/api/quick-prompts', asyncHandler(this.createQuickPrompt.bind(this)));
    router.get('/api/quick-prompts/:id', asyncHandler(this.getQuickPromptById.bind(this)));
    router.get('/api/quick-prompts', asyncHandler(this.listQuickPrompts.bind(this)));
    router.put('/api/quick-prompts/:id', asyncHandler(this.updateQuickPrompt.bind(this)));
    router.delete('/api/quick-prompts/:id', asyncHandler(this.deleteQuickPrompt.bind(this)));
    router.post('/api/quick-prompts/:id/clone', asyncHandler(this.cloneQuickPrompt.bind(this)));

    router.post('/api/projects/:projectId/quick-prompts', asyncHandler(this.createProjectQuickPrompt.bind(this)));
    router.get('/api/projects/:projectId/quick-prompts/:id', asyncHandler(this.getProjectQuickPromptById.bind(this)));
    router.get('/api/projects/:projectId/quick-prompts', asyncHandler(this.listProjectQuickPrompts.bind(this)));
    router.put('/api/projects/:projectId/quick-prompts/:id', asyncHandler(this.updateProjectQuickPrompt.bind(this)));
    router.delete('/api/projects/:projectId/quick-prompts/:id', asyncHandler(this.deleteProjectQuickPrompt.bind(this)));
    router.post('/api/projects/:projectId/quick-prompts/:id/clone', asyncHandler(this.cloneProjectQuickPrompt.bind(this)));
  }

  private async createQuickPrompt(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.QUICK_PROMPT_WRITE]);
    const body = createQuickPromptSchema.parse(req.body);
    const prompt = await this.quickPromptService.createQuickPrompt(body, req.context);
    res.status(201).json(prompt);
  }

  private async getQuickPromptById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.QUICK_PROMPT_READ]);
    const { id } = quickPromptRouteParamsSchema.parse(req.params);
    const prompt = await this.quickPromptService.getQuickPromptById(id, req.context);
    res.status(200).json(prompt);
  }

  private async listQuickPrompts(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.QUICK_PROMPT_READ]);
    const query = listParamsSchema.parse(req.query);
    const result = await this.quickPromptService.listQuickPrompts(undefined, req.context, query);
    res.status(200).json(result);
  }

  private async updateQuickPrompt(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.QUICK_PROMPT_WRITE]);
    const { id } = quickPromptRouteParamsSchema.parse(req.params);
    const body = updateQuickPromptBodySchema.parse(req.body);
    const prompt = await this.quickPromptService.updateQuickPrompt(id, body, req.context);
    res.status(200).json(prompt);
  }

  private async deleteQuickPrompt(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.QUICK_PROMPT_DELETE]);
    const { id } = quickPromptRouteParamsSchema.parse(req.params);
    const body = deleteQuickPromptBodySchema.parse(req.body);
    await this.quickPromptService.deleteQuickPrompt(id, body.version, req.context);
    res.status(204).send();
  }

  private async cloneQuickPrompt(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.QUICK_PROMPT_WRITE]);
    const { id } = quickPromptRouteParamsSchema.parse(req.params);
    const body = cloneQuickPromptSchema.parse(req.body);
    const result = await this.quickPromptService.cloneQuickPrompt(id, body, req.context);
    res.status(201).json(result);
  }

  private async createProjectQuickPrompt(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.QUICK_PROMPT_WRITE]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const body = createProjectQuickPromptSchema.parse(req.body);
    const prompt = await this.quickPromptService.createProjectQuickPrompt(projectId, body, req.context);
    res.status(201).json(prompt);
  }

  private async getProjectQuickPromptById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.QUICK_PROMPT_READ]);
    const { projectId, id } = quickPromptProjectRouteParamsSchema.parse(req.params);
    const prompt = await this.quickPromptService.getQuickPromptById(id, req.context, projectId);
    res.status(200).json(prompt);
  }

  private async listProjectQuickPrompts(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.QUICK_PROMPT_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const result = await this.quickPromptService.listQuickPrompts(projectId, req.context, query);
    res.status(200).json(result);
  }

  private async updateProjectQuickPrompt(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.QUICK_PROMPT_WRITE]);
    const { projectId, id } = quickPromptProjectRouteParamsSchema.parse(req.params);
    const body = updateQuickPromptBodySchema.parse(req.body);
    const prompt = await this.quickPromptService.updateQuickPrompt(id, body, req.context, projectId);
    res.status(200).json(prompt);
  }

  private async deleteProjectQuickPrompt(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.QUICK_PROMPT_DELETE]);
    const { projectId, id } = quickPromptProjectRouteParamsSchema.parse(req.params);
    const body = deleteQuickPromptBodySchema.parse(req.body);
    await this.quickPromptService.deleteQuickPrompt(id, body.version, req.context, projectId);
    res.status(204).send();
  }

  private async cloneProjectQuickPrompt(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.QUICK_PROMPT_WRITE]);
    const { projectId, id } = quickPromptProjectRouteParamsSchema.parse(req.params);
    const body = cloneQuickPromptSchema.parse(req.body);
    const result = await this.quickPromptService.cloneQuickPrompt(id, body, req.context, projectId);
    res.status(201).json(result);
  }
}

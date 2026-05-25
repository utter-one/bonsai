import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { ScenarioConversationService } from '../../services/testing/ScenarioConversationService';
import { scenarioConversationResponseSchema, scenarioConversationListResponseSchema, scenarioConversationRouteParamsSchema, scenarioConversationListParamsSchema } from '../contracts/scenarioConversation';
import { projectScopedParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for scenario conversation reads
 */
@singleton()
export class ScenarioConversationController {
  constructor(@inject(ScenarioConversationService) private readonly scenarioConversationService: ScenarioConversationService) { }

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'get',
        path: '/api/projects/{projectId}/scenario-conversations',
        tags: ['Scenario Conversations'],
        summary: 'List scenario conversations',
        description: 'Retrieves a paginated list of scenario conversations. Use the scenarioRunId query parameter to filter by run.',
        request: {
          query: scenarioConversationListParamsSchema,
        },
        responses: {
          200: {
            description: 'List of scenario conversations retrieved successfully',
            content: { 'application/json': { schema: scenarioConversationListResponseSchema } },
          },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/scenario-conversations/{id}',
        tags: ['Scenario Conversations'],
        summary: 'Get scenario conversation by ID',
        description: 'Retrieves a single scenario conversation by its unique identifier',
        request: {
          params: scenarioConversationRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Scenario conversation retrieved successfully',
            content: { 'application/json': { schema: scenarioConversationResponseSchema } },
          },
          404: { description: 'Scenario conversation not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.get('/api/projects/:projectId/scenario-conversations', asyncHandler(this.listScenarioConversations.bind(this)));
    router.get('/api/projects/:projectId/scenario-conversations/:id', asyncHandler(this.getScenarioConversationById.bind(this)));
  }

  private async listScenarioConversations(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SCENARIO_RUN_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const query = scenarioConversationListParamsSchema.parse(req.query);
    const conversations = await this.scenarioConversationService.listScenarioConversations(projectId, query);
    res.status(200).json(conversations);
  }

  private async getScenarioConversationById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SCENARIO_RUN_READ]);
    const params = scenarioConversationRouteParamsSchema.parse(req.params);
    const conversation = await this.scenarioConversationService.getScenarioConversationById(params.projectId, params.id);
    res.status(200).json(conversation);
  }
}

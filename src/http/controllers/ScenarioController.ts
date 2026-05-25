import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { ScenarioService } from '../../services/testing/ScenarioService';
import { createScenarioSchema, updateScenarioBodySchema, deleteScenarioBodySchema, scenarioResponseSchema, scenarioListResponseSchema, scenarioRouteParamsSchema } from '../contracts/scenario';
import { listParamsSchema, projectScopedParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for test scenario management
 */
@singleton()
export class ScenarioController {
  constructor(@inject(ScenarioService) private readonly scenarioService: ScenarioService) { }

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/projects/{projectId}/scenarios',
        tags: ['Scenarios'],
        summary: 'Create a new scenario',
        description: 'Creates a new test scenario defining the conversation flow, data extraction, and success criteria',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createScenarioSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Scenario created successfully',
            content: { 'application/json': { schema: scenarioResponseSchema } },
          },
          400: { description: 'Invalid request body' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/scenarios',
        tags: ['Scenarios'],
        summary: 'List scenarios',
        description: 'Retrieves a paginated list of scenarios with optional filtering and sorting',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of scenarios retrieved successfully',
            content: { 'application/json': { schema: scenarioListResponseSchema } },
          },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/scenarios/{id}',
        tags: ['Scenarios'],
        summary: 'Get scenario by ID',
        description: 'Retrieves a single scenario by its unique identifier',
        request: {
          params: scenarioRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Scenario retrieved successfully',
            content: { 'application/json': { schema: scenarioResponseSchema } },
          },
          404: { description: 'Scenario not found' },
        },
      },
      {
        method: 'put',
        path: '/api/projects/{projectId}/scenarios/{id}',
        tags: ['Scenarios'],
        summary: 'Update scenario',
        description: 'Updates an existing scenario with optimistic locking',
        request: {
          params: scenarioRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: updateScenarioBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Scenario updated successfully',
            content: { 'application/json': { schema: scenarioResponseSchema } },
          },
          400: { description: 'Invalid request body' },
          404: { description: 'Scenario not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/scenarios/{id}',
        tags: ['Scenarios'],
        summary: 'Delete scenario',
        description: 'Deletes a scenario with optimistic locking',
        request: {
          params: scenarioRouteParamsSchema,
          body: {
            content: {
              'application/json': {
                schema: deleteScenarioBodySchema,
              },
            },
          },
        },
        responses: {
          204: { description: 'Scenario deleted successfully' },
          404: { description: 'Scenario not found' },
          409: { description: 'Version conflict - entity was modified' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/scenarios/{id}/audit-logs',
        tags: ['Scenarios'],
        summary: 'Get scenario audit logs',
        description: 'Retrieves audit logs for a specific scenario',
        request: {
          params: scenarioRouteParamsSchema,
        },
        responses: {
          200: { description: 'Audit logs retrieved successfully' },
          404: { description: 'Scenario not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/projects/:projectId/scenarios', asyncHandler(this.createScenario.bind(this)));
    router.get('/api/projects/:projectId/scenarios', asyncHandler(this.listScenarios.bind(this)));
    router.get('/api/projects/:projectId/scenarios/:id', asyncHandler(this.getScenarioById.bind(this)));
    router.put('/api/projects/:projectId/scenarios/:id', asyncHandler(this.updateScenario.bind(this)));
    router.delete('/api/projects/:projectId/scenarios/:id', asyncHandler(this.deleteScenario.bind(this)));
    router.get('/api/projects/:projectId/scenarios/:id/audit-logs', asyncHandler(this.getScenarioAuditLogs.bind(this)));
  }

  private async createScenario(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SCENARIO_WRITE]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const body = createScenarioSchema.parse(req.body);
    const scenario = await this.scenarioService.createScenario(projectId, body, req.context);
    res.status(201).json(scenario);
  }

  private async listScenarios(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SCENARIO_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const scenarios = await this.scenarioService.listScenarios(projectId, query);
    res.status(200).json(scenarios);
  }

  private async getScenarioById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SCENARIO_READ]);
    const params = scenarioRouteParamsSchema.parse(req.params);
    const scenario = await this.scenarioService.getScenarioById(params.projectId, params.id);
    res.status(200).json(scenario);
  }

  private async updateScenario(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SCENARIO_WRITE]);
    const params = scenarioRouteParamsSchema.parse(req.params);
    const body = updateScenarioBodySchema.parse(req.body);
    const scenario = await this.scenarioService.updateScenario(params.projectId, params.id, body, req.context);
    res.status(200).json(scenario);
  }

  private async deleteScenario(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SCENARIO_DELETE]);
    const params = scenarioRouteParamsSchema.parse(req.params);
    const body = deleteScenarioBodySchema.parse(req.body);
    await this.scenarioService.deleteScenario(params.projectId, params.id, body.version, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/projects/:projectId/scenarios/:id/audit-logs
   * Get audit logs for a scenario
   */
  private async getScenarioAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = scenarioRouteParamsSchema.parse(req.params);
    const logs = await this.scenarioService.getScenarioAuditLogs(params.id, params.projectId);
    res.status(200).json(logs);
  }
}

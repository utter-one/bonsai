import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { PERMISSIONS } from '../../permissions';
import { ScenarioRunService } from '../../services/testing/ScenarioRunService';
import { ScenarioRunExecutorService } from '../../services/testing/ScenarioRunExecutorService';
import { createScenarioRunSchema, scenarioRunResponseSchema, scenarioRunListResponseSchema, scenarioRunRouteParamsSchema } from '../contracts/scenarioRun';
import { listParamsSchema, projectScopedParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/** Schema for the scheduler status response */
const schedulerStatusSchema = z.object({
  enabled: z.boolean().describe('Whether the scenario run scheduler is currently enabled'),
});

/** Schema for updating the scheduler status */
const updateSchedulerStatusSchema = z.object({
  enabled: z.boolean().describe('Set to true to enable the scheduler, false to disable it'),
});

/**
 * Controller for scenario run management
 */
@singleton()
export class ScenarioRunController {
  constructor(
    @inject(ScenarioRunService) private readonly scenarioRunService: ScenarioRunService,
    @inject(ScenarioRunExecutorService) private readonly executorService: ScenarioRunExecutorService,
  ) { }

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/projects/{projectId}/scenario-runs',
        tags: ['Scenario Runs'],
        summary: 'Create a new scenario run',
        description: 'Creates a new scenario run instance with status queued, ready to be picked up by the testing engine',
        request: {
          body: {
            content: {
              'application/json': {
                schema: createScenarioRunSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Scenario run created successfully',
            content: { 'application/json': { schema: scenarioRunResponseSchema } },
          },
          400: { description: 'Invalid request body' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/scenario-runs',
        tags: ['Scenario Runs'],
        summary: 'List scenario runs',
        description: 'Retrieves a paginated list of scenario runs with optional filtering and sorting',
        request: {
          query: listParamsSchema,
        },
        responses: {
          200: {
            description: 'List of scenario runs retrieved successfully',
            content: { 'application/json': { schema: scenarioRunListResponseSchema } },
          },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/scenario-runs/{id}',
        tags: ['Scenario Runs'],
        summary: 'Get scenario run by ID',
        description: 'Retrieves a single scenario run by its unique identifier',
        request: {
          params: scenarioRunRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Scenario run retrieved successfully',
            content: { 'application/json': { schema: scenarioRunResponseSchema } },
          },
          404: { description: 'Scenario run not found' },
        },
      },
      {
        method: 'post',
        path: '/api/projects/{projectId}/scenario-runs/{id}/cancel',
        tags: ['Scenario Runs'],
        summary: 'Cancel a scenario run',
        description: 'Cancels a scenario run that is currently queued or in progress. Already-running conversation slots will complete but no new slots will start.',
        request: {
          params: scenarioRunRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Scenario run cancelled successfully',
            content: { 'application/json': { schema: scenarioRunResponseSchema } },
          },
          404: { description: 'Scenario run not found' },
          409: { description: 'Scenario run is in a terminal state and cannot be cancelled' },
        },
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/scenario-runs/{id}',
        tags: ['Scenario Runs'],
        summary: 'Delete a scenario run',
        description: 'Permanently deletes a scenario run and all its associated conversations. Only runs in terminal states (passed, failed, cancelled) can be deleted.',
        request: {
          params: scenarioRunRouteParamsSchema,
        },
        responses: {
          204: { description: 'Scenario run deleted successfully' },
          404: { description: 'Scenario run not found' },
          409: { description: 'Scenario run is not in a terminal state. Cancel it first.' },
        },
      },
      {
        method: 'get',
        path: '/api/scenario-runs/scheduler',
        tags: ['Scenario Runs'],
        summary: 'Get scheduler status',
        description: 'Returns whether the scenario run scheduler (circuit breaker) is currently enabled',
        responses: {
          200: {
            description: 'Scheduler status',
            content: { 'application/json': { schema: schedulerStatusSchema } },
          },
        },
      },
      {
        method: 'put',
        path: '/api/scenario-runs/scheduler',
        tags: ['Scenario Runs'],
        summary: 'Update scheduler status',
        description: 'Enables or disables the scenario run scheduler circuit breaker. Disabling stops new executions from starting; in-flight runs complete normally.',
        request: {
          body: {
            content: {
              'application/json': {
                schema: updateSchedulerStatusSchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Scheduler status updated',
            content: { 'application/json': { schema: schedulerStatusSchema } },
          },
          400: { description: 'Invalid request body' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/projects/:projectId/scenario-runs', asyncHandler(this.createScenarioRun.bind(this)));
    router.get('/api/projects/:projectId/scenario-runs', asyncHandler(this.listScenarioRuns.bind(this)));
    router.get('/api/projects/:projectId/scenario-runs/:id', asyncHandler(this.getScenarioRunById.bind(this)));
    router.post('/api/projects/:projectId/scenario-runs/:id/cancel', asyncHandler(this.cancelScenarioRun.bind(this)));
    router.delete('/api/projects/:projectId/scenario-runs/:id', asyncHandler(this.deleteScenarioRun.bind(this)));
    router.get('/api/scenario-runs/scheduler', asyncHandler(this.getSchedulerStatus.bind(this)));
    router.put('/api/scenario-runs/scheduler', asyncHandler(this.updateSchedulerStatus.bind(this)));
  }

  private async createScenarioRun(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SCENARIO_RUN_WRITE]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const body = createScenarioRunSchema.parse(req.body);
    const run = await this.scenarioRunService.createScenarioRun(projectId, body, req.context);
    this.executorService.notifyNewRun();
    res.status(201).json(run);
  }

  private async listScenarioRuns(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SCENARIO_RUN_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const runs = await this.scenarioRunService.listScenarioRuns(projectId, query);
    res.status(200).json(runs);
  }

  private async getScenarioRunById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SCENARIO_RUN_READ]);
    const params = scenarioRunRouteParamsSchema.parse(req.params);
    const run = await this.scenarioRunService.getScenarioRunById(params.projectId, params.id);
    res.status(200).json(run);
  }

  private async getSchedulerStatus(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SYSTEM_CONFIG]);
    res.status(200).json(this.executorService.getStatus());
  }

  private async updateSchedulerStatus(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SYSTEM_CONFIG]);
    const body = updateSchedulerStatusSchema.parse(req.body);
    if (body.enabled) {
      this.executorService.enable();
    } else {
      this.executorService.disable();
    }
    res.status(200).json(this.executorService.getStatus());
  }

  private async cancelScenarioRun(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SCENARIO_RUN_WRITE]);
    const params = scenarioRunRouteParamsSchema.parse(req.params);
    const run = await this.scenarioRunService.cancelScenarioRun(params.id, params.projectId, req.context?.operatorId);
    this.executorService.signalCancel(params.id);
    res.status(200).json(run);
  }

  private async deleteScenarioRun(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.SCENARIO_RUN_WRITE]);
    const params = scenarioRunRouteParamsSchema.parse(req.params);
    await this.scenarioRunService.deleteScenarioRun(params.id, params.projectId);
    res.status(204).send();
  }
}

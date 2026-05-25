import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { BenchmarkRunService } from '../../services/BenchmarkRunService';
import { triggerBenchmarkRunSchema, benchmarkRunListParamsSchema, benchmarkRunResponseSchema, benchmarkRunListResponseSchema, benchmarkResultResponseSchema, benchmarkRunRouteParamsSchema, benchmarkConfigRouteParamsSchema } from '../contracts/benchmark';
import type { TriggerBenchmarkRunRequest } from '../contracts/benchmark';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for benchmark run operations: trigger, list, get (with executions), and results.
 */
@singleton()
export class BenchmarkRunController {
  constructor(@inject(BenchmarkRunService) private readonly service: BenchmarkRunService) { }

  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/benchmarks/runs',
        tags: ['Benchmarks'],
        summary: 'Trigger a benchmark run',
        description: 'Triggers a manual benchmark run for the specified suite. The run is queued and executed asynchronously.',
        request: { body: { content: { 'application/json': { schema: triggerBenchmarkRunSchema } } } },
        responses: {
          201: { description: 'Benchmark run triggered', content: { 'application/json': { schema: benchmarkRunResponseSchema } } },
          400: { description: 'Invalid request body' },
        },
      },
      {
        method: 'get',
        path: '/api/benchmarks/runs',
        tags: ['Benchmarks'],
        summary: 'List benchmark runs',
        description: 'Returns paginated benchmark runs, optionally filtered by suiteId or status',
        request: { query: benchmarkRunListParamsSchema },
        responses: {
          200: { description: 'Paginated list of benchmark runs', content: { 'application/json': { schema: benchmarkRunListResponseSchema } } },
        },
      },
      {
        method: 'get',
        path: '/api/benchmarks/runs/{id}',
        tags: ['Benchmarks'],
        summary: 'Get a benchmark run',
        description: 'Returns a single benchmark run with its embedded config executions',
        request: { params: benchmarkRunRouteParamsSchema },
        responses: {
          200: { description: 'Benchmark run with executions', content: { 'application/json': { schema: benchmarkRunResponseSchema } } },
          404: { description: 'Not found' },
        },
      },
      {
        method: 'get',
        path: '/api/benchmarks/executions/{id}/results',
        tags: ['Benchmarks'],
        summary: 'Get iteration results for a config execution',
        description: 'Returns all raw iteration results for a given config execution ID',
        request: { params: benchmarkConfigRouteParamsSchema },
        responses: {
          200: { description: 'Iteration results', content: { 'application/json': { schema: benchmarkResultResponseSchema.array() } } },
        },
      },
      {
        method: 'delete',
        path: '/api/benchmarks/runs/{id}',
        tags: ['Benchmarks'],
        summary: 'Delete a benchmark run',
        description: 'Deletes a benchmark run and all its associated executions and results. Blocked if the run is currently in progress.',
        request: { params: benchmarkRunRouteParamsSchema },
        responses: {
          204: { description: 'Deleted' },
          404: { description: 'Not found' },
          409: { description: 'Cannot delete: run is currently in progress.' },
        },
      },
    ];
  }

  registerRoutes(router: Router): void {
    router.post('/api/benchmarks/runs', asyncHandler(this.triggerRun.bind(this)));
    router.get('/api/benchmarks/runs', asyncHandler(this.listRuns.bind(this)));
    router.get('/api/benchmarks/runs/:id', asyncHandler(this.getRun.bind(this)));
    router.delete('/api/benchmarks/runs/:id', asyncHandler(this.deleteRun.bind(this)));
    router.get('/api/benchmarks/executions/:id/results', asyncHandler(this.getResults.bind(this)));
  }

  private async triggerRun(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.BENCHMARK_RUN]);
    const body = triggerBenchmarkRunSchema.parse(req.body) as TriggerBenchmarkRunRequest;
    const result = await this.service.triggerRun(body, req.context);
    res.status(201).json(result);
  }

  private async listRuns(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.BENCHMARK_READ]);
    const query = benchmarkRunListParamsSchema.parse(req.query);
    const result = await this.service.listRuns(query, req.context);
    res.status(200).json(result);
  }

  private async getRun(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.BENCHMARK_READ]);
    const params = benchmarkRunRouteParamsSchema.parse(req.params);
    const result = await this.service.getRunById(params.id, req.context);
    res.status(200).json(result);
  }

  private async getResults(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.BENCHMARK_READ]);
    const params = benchmarkConfigRouteParamsSchema.parse(req.params);
    const result = await this.service.getRunResults(params.id, req.context);
    res.status(200).json(result);
  }

  private async deleteRun(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.BENCHMARK_WRITE]);
    const params = benchmarkRunRouteParamsSchema.parse(req.params);
    await this.service.deleteRun(params.id, req.context);
    res.status(204).send();
  }
}

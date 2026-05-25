import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { BenchmarkService } from '../../services/BenchmarkService';
import { createBenchmarkSuiteSchema, updateBenchmarkSuiteSchema, benchmarkSuiteResponseSchema, benchmarkSuiteListResponseSchema, benchmarkConfigListResponseSchema, benchmarkSuiteRouteParamsSchema, listParamsSchema } from '../contracts/benchmark';
import type { CreateBenchmarkSuiteRequest, UpdateBenchmarkSuiteRequest } from '../contracts/benchmark';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for benchmark suite CRUD operations.
 */
@singleton()
export class BenchmarkSuiteController {
  constructor(@inject(BenchmarkService) private readonly service: BenchmarkService) { }

  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'get',
        path: '/api/benchmarks/suites',
        tags: ['Benchmarks'],
        summary: 'List benchmark suites',
        description: 'Returns paginated benchmark suites ordered by creation date descending',
        request: { query: listParamsSchema },
        responses: {
          200: { description: 'Paginated list of benchmark suites', content: { 'application/json': { schema: benchmarkSuiteListResponseSchema } } },
        },
      },
      {
        method: 'post',
        path: '/api/benchmarks/suites',
        tags: ['Benchmarks'],
        summary: 'Create a benchmark suite',
        description: 'Creates a new benchmark suite with optional cron schedule',
        request: { body: { content: { 'application/json': { schema: createBenchmarkSuiteSchema } } } },
        responses: {
          201: { description: 'Benchmark suite created', content: { 'application/json': { schema: benchmarkSuiteResponseSchema } } },
          400: { description: 'Invalid request body' },
        },
      },
      {
        method: 'get',
        path: '/api/benchmarks/suites/{id}',
        tags: ['Benchmarks'],
        summary: 'Get a benchmark suite',
        description: 'Returns a single benchmark suite by ID',
        request: { params: benchmarkSuiteRouteParamsSchema },
        responses: {
          200: { description: 'Benchmark suite', content: { 'application/json': { schema: benchmarkSuiteResponseSchema } } },
          404: { description: 'Not found' },
        },
      },
      {
        method: 'put',
        path: '/api/benchmarks/suites/{id}',
        tags: ['Benchmarks'],
        summary: 'Update a benchmark suite',
        description: 'Updates an existing benchmark suite',
        request: { params: benchmarkSuiteRouteParamsSchema, body: { content: { 'application/json': { schema: updateBenchmarkSuiteSchema } } } },
        responses: {
          200: { description: 'Updated benchmark suite', content: { 'application/json': { schema: benchmarkSuiteResponseSchema } } },
          404: { description: 'Not found' },
          409: { description: 'Concurrent modification conflict' },
        },
      },
      {
        method: 'delete',
        path: '/api/benchmarks/suites/{id}',
        tags: ['Benchmarks'],
        summary: 'Delete a benchmark suite',
        description: 'Deletes a benchmark suite and all its associated configs (cascade). Blocked if any runs exist for the suite.',
        request: { params: benchmarkSuiteRouteParamsSchema },
        responses: {
          204: { description: 'Deleted' },
          404: { description: 'Not found' },
          409: { description: 'Cannot delete: suite has existing runs. Delete all runs first.' },
        },
      },
      {
        method: 'get',
        path: '/api/benchmarks/suites/{id}/configs',
        tags: ['Benchmarks'],
        summary: 'List configs for a suite',
        description: 'Returns paginated benchmark configs belonging to a suite',
        request: { params: benchmarkSuiteRouteParamsSchema, query: listParamsSchema },
        responses: {
          200: { description: 'Paginated list of benchmark configs', content: { 'application/json': { schema: benchmarkConfigListResponseSchema } } },
          404: { description: 'Not found' },
        },
      },
    ];
  }

  registerRoutes(router: Router): void {
    router.get('/api/benchmarks/suites', asyncHandler(this.listSuites.bind(this)));
    router.post('/api/benchmarks/suites', asyncHandler(this.createSuite.bind(this)));
    router.get('/api/benchmarks/suites/:id', asyncHandler(this.getSuite.bind(this)));
    router.put('/api/benchmarks/suites/:id', asyncHandler(this.updateSuite.bind(this)));
    router.delete('/api/benchmarks/suites/:id', asyncHandler(this.deleteSuite.bind(this)));
    router.get('/api/benchmarks/suites/:id/configs', asyncHandler(this.listSuiteConfigs.bind(this)));
  }

  private async listSuites(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.BENCHMARK_READ]);
    const query = listParamsSchema.parse(req.query);
    const result = await this.service.listSuites(query, req.context);
    res.status(200).json(result);
  }

  private async createSuite(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.BENCHMARK_WRITE]);
    const body = createBenchmarkSuiteSchema.parse(req.body) as CreateBenchmarkSuiteRequest;
    const result = await this.service.createSuite(body, req.context);
    res.status(201).json(result);
  }

  private async getSuite(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.BENCHMARK_READ]);
    const params = benchmarkSuiteRouteParamsSchema.parse(req.params);
    const result = await this.service.getSuite(params.id, req.context);
    res.status(200).json(result);
  }

  private async updateSuite(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.BENCHMARK_WRITE]);
    const params = benchmarkSuiteRouteParamsSchema.parse(req.params);
    const body = updateBenchmarkSuiteSchema.parse(req.body) as UpdateBenchmarkSuiteRequest;
    const result = await this.service.updateSuite(params.id, body, req.context);
    res.status(200).json(result);
  }

  private async deleteSuite(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.BENCHMARK_WRITE]);
    const params = benchmarkSuiteRouteParamsSchema.parse(req.params);
    await this.service.deleteSuite(params.id, req.context);
    res.status(204).send();
  }

  private async listSuiteConfigs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.BENCHMARK_READ]);
    const params = benchmarkSuiteRouteParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const result = await this.service.listConfigsForSuite(params.id, query, req.context);
    res.status(200).json(result);
  }
}

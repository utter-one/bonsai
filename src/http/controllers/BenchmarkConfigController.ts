import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { BenchmarkService } from '../../services/BenchmarkService';
import { createBenchmarkConfigSchema, updateBenchmarkConfigSchema, benchmarkConfigResponseSchema, benchmarkConfigRouteParamsSchema } from '../contracts/benchmark';
import type { CreateBenchmarkConfigRequest, UpdateBenchmarkConfigRequest } from '../contracts/benchmark';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for benchmark config (test case) CRUD operations.
 */
@singleton()
export class BenchmarkConfigController {
  constructor(@inject(BenchmarkService) private readonly service: BenchmarkService) { }

  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/benchmarks/configs',
        tags: ['Benchmarks'],
        summary: 'Create a benchmark config',
        description: 'Creates a new benchmark test case, linked to a suite and provider config',
        request: { body: { content: { 'application/json': { schema: createBenchmarkConfigSchema } } } },
        responses: {
          201: { description: 'Benchmark config created', content: { 'application/json': { schema: benchmarkConfigResponseSchema } } },
          400: { description: 'Invalid request body' },
          404: { description: 'Suite not found' },
        },
      },
      {
        method: 'get',
        path: '/api/benchmarks/configs/{id}',
        tags: ['Benchmarks'],
        summary: 'Get a benchmark config',
        description: 'Returns a single benchmark config by ID',
        request: { params: benchmarkConfigRouteParamsSchema },
        responses: {
          200: { description: 'Benchmark config', content: { 'application/json': { schema: benchmarkConfigResponseSchema } } },
          404: { description: 'Not found' },
        },
      },
      {
        method: 'put',
        path: '/api/benchmarks/configs/{id}',
        tags: ['Benchmarks'],
        summary: 'Update a benchmark config',
        description: 'Updates an existing benchmark config',
        request: { params: benchmarkConfigRouteParamsSchema, body: { content: { 'application/json': { schema: updateBenchmarkConfigSchema } } } },
        responses: {
          200: { description: 'Updated benchmark config', content: { 'application/json': { schema: benchmarkConfigResponseSchema } } },
          404: { description: 'Not found' },
          409: { description: 'Concurrent modification conflict' },
        },
      },
      {
        method: 'delete',
        path: '/api/benchmarks/configs/{id}',
        tags: ['Benchmarks'],
        summary: 'Delete a benchmark config',
        description: 'Deletes a benchmark config. Blocked if any config executions exist (i.e., the config has been run). Delete the associated runs first.',
        request: { params: benchmarkConfigRouteParamsSchema },
        responses: {
          204: { description: 'Deleted' },
          404: { description: 'Not found' },
          409: { description: 'Cannot delete: config has existing executions. Delete the associated runs first.' },
        },
      },
    ];
  }

  registerRoutes(router: Router): void {
    router.post('/api/benchmarks/configs', asyncHandler(this.createConfig.bind(this)));
    router.get('/api/benchmarks/configs/:id', asyncHandler(this.getConfig.bind(this)));
    router.put('/api/benchmarks/configs/:id', asyncHandler(this.updateConfig.bind(this)));
    router.delete('/api/benchmarks/configs/:id', asyncHandler(this.deleteConfig.bind(this)));
  }

  private async createConfig(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.BENCHMARK_WRITE]);
    const body = createBenchmarkConfigSchema.parse(req.body) as CreateBenchmarkConfigRequest;
    const result = await this.service.createConfig(body, req.context);
    res.status(201).json(result);
  }

  private async getConfig(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.BENCHMARK_READ]);
    const params = benchmarkConfigRouteParamsSchema.parse(req.params);
    const result = await this.service.getConfig(params.id, req.context);
    res.status(200).json(result);
  }

  private async updateConfig(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.BENCHMARK_WRITE]);
    const params = benchmarkConfigRouteParamsSchema.parse(req.params);
    const body = updateBenchmarkConfigSchema.parse(req.body) as UpdateBenchmarkConfigRequest;
    const result = await this.service.updateConfig(params.id, body, req.context);
    res.status(200).json(result);
  }

  private async deleteConfig(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.BENCHMARK_WRITE]);
    const params = benchmarkConfigRouteParamsSchema.parse(req.params);
    await this.service.deleteConfig(params.id, req.context);
    res.status(204).send();
  }
}

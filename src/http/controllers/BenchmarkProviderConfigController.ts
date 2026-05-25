import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { BenchmarkService } from '../../services/BenchmarkService';
import { createBenchmarkProviderConfigSchema, updateBenchmarkProviderConfigSchema, benchmarkProviderConfigResponseSchema, benchmarkProviderConfigListResponseSchema, benchmarkProviderConfigRouteParamsSchema, listParamsSchema } from '../contracts/benchmark';
import type { CreateBenchmarkProviderConfigRequest, UpdateBenchmarkProviderConfigRequest } from '../contracts/benchmark';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for benchmark provider config CRUD operations.
 */
@singleton()
export class BenchmarkProviderConfigController {
  constructor(@inject(BenchmarkService) private readonly service: BenchmarkService) { }

  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'get',
        path: '/api/benchmarks/provider-configs',
        tags: ['Benchmarks'],
        summary: 'List benchmark provider configs',
        description: 'Returns paginated benchmark provider configs ordered by creation date descending',
        request: { query: listParamsSchema },
        responses: {
          200: { description: 'Paginated list of benchmark provider configs', content: { 'application/json': { schema: benchmarkProviderConfigListResponseSchema } } },
        },
      },
      {
        method: 'post',
        path: '/api/benchmarks/provider-configs',
        tags: ['Benchmarks'],
        summary: 'Create a benchmark provider config',
        description: 'Creates a reusable provider configuration snapshot for use in benchmark configs',
        request: { body: { content: { 'application/json': { schema: createBenchmarkProviderConfigSchema } } } },
        responses: {
          201: { description: 'Benchmark provider config created', content: { 'application/json': { schema: benchmarkProviderConfigResponseSchema } } },
          400: { description: 'Invalid request body' },
        },
      },
      {
        method: 'get',
        path: '/api/benchmarks/provider-configs/{id}',
        tags: ['Benchmarks'],
        summary: 'Get a benchmark provider config',
        description: 'Returns a single benchmark provider config by ID',
        request: { params: benchmarkProviderConfigRouteParamsSchema },
        responses: {
          200: { description: 'Benchmark provider config', content: { 'application/json': { schema: benchmarkProviderConfigResponseSchema } } },
          404: { description: 'Not found' },
        },
      },
      {
        method: 'put',
        path: '/api/benchmarks/provider-configs/{id}',
        tags: ['Benchmarks'],
        summary: 'Update a benchmark provider config',
        description: 'Updates an existing benchmark provider config',
        request: { params: benchmarkProviderConfigRouteParamsSchema, body: { content: { 'application/json': { schema: updateBenchmarkProviderConfigSchema } } } },
        responses: {
          200: { description: 'Updated benchmark provider config', content: { 'application/json': { schema: benchmarkProviderConfigResponseSchema } } },
          404: { description: 'Not found' },
          409: { description: 'Concurrent modification conflict' },
        },
      },
      {
        method: 'delete',
        path: '/api/benchmarks/provider-configs/{id}',
        tags: ['Benchmarks'],
        summary: 'Delete a benchmark provider config',
        description: 'Deletes a benchmark provider config. Blocked if any benchmark configs reference it.',
        request: { params: benchmarkProviderConfigRouteParamsSchema },
        responses: {
          204: { description: 'Deleted' },
          404: { description: 'Not found' },
          409: { description: 'Cannot delete: provider config is referenced by one or more benchmark configs. Delete those configs first.' },
        },
      },
    ];
  }

  registerRoutes(router: Router): void {
    router.get('/api/benchmarks/provider-configs', asyncHandler(this.listProviderConfigs.bind(this)));
    router.post('/api/benchmarks/provider-configs', asyncHandler(this.createProviderConfig.bind(this)));
    router.get('/api/benchmarks/provider-configs/:id', asyncHandler(this.getProviderConfig.bind(this)));
    router.put('/api/benchmarks/provider-configs/:id', asyncHandler(this.updateProviderConfig.bind(this)));
    router.delete('/api/benchmarks/provider-configs/:id', asyncHandler(this.deleteProviderConfig.bind(this)));
  }

  private async listProviderConfigs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.BENCHMARK_READ]);
    const query = listParamsSchema.parse(req.query);
    const result = await this.service.listProviderConfigs(query, req.context);
    res.status(200).json(result);
  }

  private async createProviderConfig(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.BENCHMARK_WRITE]);
    const body = createBenchmarkProviderConfigSchema.parse(req.body) as CreateBenchmarkProviderConfigRequest;
    const result = await this.service.createProviderConfig(body, req.context);
    res.status(201).json(result);
  }

  private async getProviderConfig(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.BENCHMARK_READ]);
    const params = benchmarkProviderConfigRouteParamsSchema.parse(req.params);
    const result = await this.service.getProviderConfig(params.id, req.context);
    res.status(200).json(result);
  }

  private async updateProviderConfig(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.BENCHMARK_WRITE]);
    const params = benchmarkProviderConfigRouteParamsSchema.parse(req.params);
    const body = updateBenchmarkProviderConfigSchema.parse(req.body) as UpdateBenchmarkProviderConfigRequest;
    const result = await this.service.updateProviderConfig(params.id, body, req.context);
    res.status(200).json(result);
  }

  private async deleteProviderConfig(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.BENCHMARK_WRITE]);
    const params = benchmarkProviderConfigRouteParamsSchema.parse(req.params);
    await this.service.deleteProviderConfig(params.id, req.context);
    res.status(204).send();
  }
}

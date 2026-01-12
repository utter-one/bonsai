import 'reflect-metadata';
import { JsonController, Get, HttpCode } from 'routing-controllers';
import { injectable } from 'tsyringe';
import { PublicRoute } from '../decorators/auth';
import { OpenAPI } from '../decorators/openapi';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

const healthResponseSchema = z.object({
  status: z.literal('healthy').describe('Health status of the service'),
  timestamp: z.string().describe('ISO timestamp of the health check'),
});

/**
 * Controller for health check endpoint
 */
@injectable()
@JsonController('/health')
export class HealthController {
  /**
   * GET /health
   * Health check endpoint for monitoring and container orchestration
   */
  @OpenAPI({
    tags: ['Health'],
    summary: 'Health check',
    description: 'Returns the health status of the service. Used for container health checks and monitoring.',
    responses: {
      200: {
        description: 'Service is healthy',
        content: {
          'application/json': {
            schema: healthResponseSchema,
          },
        },
      },
    },
  })
  @PublicRoute()
  @Get('/')
  @HttpCode(200)
  async healthCheck() {
    return {
      status: 'healthy' as const,
      timestamp: new Date().toISOString(),
    };
  }
}

import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { VersionService } from '../../services/VersionService';
import { versionResponseSchema } from '../contracts/version';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller exposing API schema version hashes.
 * All routes are unauthenticated — intended for clients and monitoring tools
 * to detect contract changes between deployments.
 */
@singleton()
export class VersionController {
  constructor(@inject(VersionService) private readonly versionService: VersionService) {}

  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'get',
        path: '/version',
        tags: ['System'],
        summary: 'Get API schema version hashes',
        description: 'Returns content-addressed SHA-256 hashes of the REST and WebSocket API schemas. ' +
          'Hashes change only when the corresponding contract files change — not on every commit. ' +
          'Use these hashes to detect breaking or additive changes between server deployments. ' +
          'No authentication required.',
        security: [],
        responses: {
          200: {
            description: 'Schema version hashes and optional git commit reference',
            content: { 'application/json': { schema: versionResponseSchema } },
          },
        },
      },
    ];
  }

  registerRoutes(router: Router): void {
    router.get('/version', asyncHandler(this.getVersion.bind(this)));
  }

  private async getVersion(_req: Request, res: Response): Promise<void> {
    res.status(200).json(this.versionService.getVersion());
  }
}

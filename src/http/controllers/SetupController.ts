import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { SetupService } from '../../services/SetupService';
import { initialOperatorSetupSchema, setupStatusResponseSchema, initialOperatorSetupResponseSchema } from '../contracts/setup';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for system setup and initialization
 * All routes are public as they are used before any operator accounts exist
 */
@singleton()
export class SetupController {
  constructor(@inject(SetupService) private readonly setupService: SetupService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'get',
        path: '/api/setup/status',
        tags: ['Setup'],
        summary: 'Check system setup status',
        description: 'Returns whether the system has been initialized with at least one operator account',
        responses: {
          200: {
            description: 'Setup status retrieved successfully',
            content: {
              'application/json': {
                schema: setupStatusResponseSchema,
              },
            },
          },
        },
      },
      {
        method: 'post',
        path: '/api/setup/initial-operator',
        tags: ['Setup'],
        summary: 'Create initial operator account',
        description: 'Creates the first operator account with super_admin role. This endpoint only works when no operator accounts exist. Returns operator details and authentication tokens for immediate login.',
        request: {
          body: {
            content: {
              'application/json': {
                schema: initialOperatorSetupSchema,
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Initial operator account created successfully with authentication tokens',
            content: {
              'application/json': {
                schema: initialOperatorSetupResponseSchema,
              },
            },
          },
          400: { description: 'Invalid request body' },
          409: { description: 'System is already configured with operator accounts' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.get('/api/setup/status', asyncHandler(this.getSetupStatus.bind(this)));
    router.post('/api/setup/initial-operator', asyncHandler(this.createInitialOperator.bind(this)));
  }

  /**
   * GET /api/setup/status
   * Check if the system has been set up with an operator account
   */
  private async getSetupStatus(req: Request, res: Response): Promise<void> {
    const status = await this.setupService.getSetupStatus();
    res.status(200).json(status);
  }

  /**
   * POST /api/setup/initial-operator
   * Create the initial operator account with full permissions
   */
  private async createInitialOperator(req: Request, res: Response): Promise<void> {
    const body = initialOperatorSetupSchema.parse(req.body);
    const result = await this.setupService.createInitialOperator(body);
    res.status(201).json(result);
  }
}

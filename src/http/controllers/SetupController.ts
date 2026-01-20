import 'reflect-metadata';
import { JsonController, Get, Post, Body, HttpCode } from 'routing-controllers';
import { injectable, inject } from 'tsyringe';
import { Validated } from '../decorators/validation';
import { OpenAPI } from '../decorators/openapi';
import { PublicRoute } from '../decorators/auth';
import { SetupService } from '../../services/SetupService';
import { initialAdminSetupSchema, setupStatusResponseSchema, initialAdminSetupResponseSchema } from '../contracts/setup';
import type { InitialAdminSetupRequest } from '../contracts/setup';

/**
 * Controller for system setup and initialization
 * All routes are public as they are used before any admin accounts exist
 */
@injectable()
@JsonController('/api/setup')
export class SetupController {
  constructor(@inject(SetupService) private readonly setupService: SetupService) {}

  /**
   * GET /api/setup/status
   * Check if the system has been set up with an admin account
   */
  @OpenAPI({
    tags: ['Setup'],
    summary: 'Check system setup status',
    description: 'Returns whether the system has been initialized with at least one admin account',
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
  })
  @PublicRoute()
  @Get('/status')
  async getSetupStatus() {
    return await this.setupService.getSetupStatus();
  }

  /**
   * POST /api/setup/initial-admin
   * Create the initial admin account with full permissions
   */
  @OpenAPI({
    tags: ['Setup'],
    summary: 'Create initial admin account',
    description: 'Creates the first admin account with super_admin role. This endpoint only works when no admin accounts exist. Returns admin details and authentication tokens for immediate login.',
    request: {
      body: {
        content: {
          'application/json': {
            schema: initialAdminSetupSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Initial admin account created successfully with authentication tokens',
        content: {
          'application/json': {
            schema: initialAdminSetupResponseSchema,
          },
        },
      },
      400: { description: 'Invalid request body' },
      409: { description: 'System is already configured with admin accounts' },
    },
  })
  @PublicRoute()
  @Post('/initial-admin')
  @HttpCode(201)
  async createInitialAdmin(@Validated(initialAdminSetupSchema) @Body() body: InitialAdminSetupRequest) {
    return await this.setupService.createInitialAdmin(body);
  }
}

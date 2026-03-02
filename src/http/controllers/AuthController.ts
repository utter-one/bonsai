import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { AuthService } from '../../services/AuthService';
import { loginSchema, refreshTokenSchema, loginResponseSchema, refreshTokenResponseSchema } from '../contracts/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import logger from '../../utils/logger';

/**
 * Controller for authentication endpoints
 */
@singleton()
export class AuthController {
  constructor(@inject(AuthService) private readonly authService: AuthService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/auth/login',
        tags: ['Authentication'],
        summary: 'Login with credentials',
        description: 'Authenticate an operator user with email/ID and password. Returns access and refresh tokens.',
        request: {
          body: {
            content: {
              'application/json': {
                schema: loginSchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Authentication successful',
            content: {
              'application/json': {
                schema: loginResponseSchema,
              },
            },
          },
          401: { description: 'Invalid credentials' },
        },
      },
      {
        method: 'post',
        path: '/api/auth/refresh',
        tags: ['Authentication'],
        summary: 'Refresh access token',
        description: 'Get a new access token using a valid refresh token',
        request: {
          body: {
            content: {
              'application/json': {
                schema: refreshTokenSchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Token refreshed successfully',
            content: {
              'application/json': {
                schema: refreshTokenResponseSchema,
              },
            },
          },
          401: { description: 'Invalid or expired refresh token' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.post('/api/auth/login', asyncHandler(this.login.bind(this)));
    router.post('/api/auth/refresh', asyncHandler(this.refresh.bind(this)));
  }

  /**
   * POST /api/auth/login
   * Authenticate with email and password
   */
  private async login(req: Request, res: Response): Promise<void> {
    const body = loginSchema.parse(req.body);
    logger.info(`Login attempt for user ID: ${body.id}, auth service: ${this.authService ? 'available' : 'not available'}`);
    const result = await this.authService.login(body.id, body.password);
    res.status(200).json(result);
  }

  /**
   * POST /api/auth/refresh
   * Refresh access token using refresh token
   */
  private async refresh(req: Request, res: Response): Promise<void> {
    const body = refreshTokenSchema.parse(req.body);
    const result = await this.authService.refresh(body.refreshToken);
    res.status(200).json(result);
  }
}

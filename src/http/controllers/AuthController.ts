import 'reflect-metadata';
import { JsonController, Post, Body, HttpCode } from 'routing-controllers';
import { injectable, inject } from 'tsyringe';
import { Validated } from '../decorators/validation';
import { OpenAPI } from '../decorators/openapi';
import { PublicRoute } from '../decorators/auth';
import { AuthService } from '../../services/AuthService';
import { loginSchema, refreshTokenSchema, loginResponseSchema, refreshTokenResponseSchema } from '../contracts/auth';
import type { LoginRequest, RefreshTokenRequest } from '../contracts/auth';

/**
 * Controller for authentication endpoints
 */
@injectable()
@JsonController('/api/auth')
export class AuthController {
  constructor(@inject(AuthService) private readonly authService: AuthService) {}

  /**
   * POST /api/auth/login
   * Authenticate with email and password
   */
  @OpenAPI({
    tags: ['Authentication'],
    summary: 'Login with credentials',
    description: 'Authenticate an admin user with email/ID and password. Returns access and refresh tokens.',
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
  })
  @PublicRoute()
  @Post('/login')
  @HttpCode(200)
  async login(@Validated(loginSchema) @Body() body: LoginRequest) {
    return await this.authService.login(body.id, body.password);
  }

  /**
   * POST /api/auth/refresh
   * Refresh access token using refresh token
   */
  @OpenAPI({
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
  })
  @PublicRoute()
  @Post('/refresh')
  @HttpCode(200)
  async refresh(@Validated(refreshTokenSchema) @Body() body: RefreshTokenRequest) {
    return await this.authService.refresh(body.refreshToken);
  }
}

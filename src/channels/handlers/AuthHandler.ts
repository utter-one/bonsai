import { inject, injectable } from 'tsyringe';
import type { ChannelHandler, ChannelHandlerContext } from '../channel';
import type { AuthRequest, AuthResponse } from '../contracts/auth';
import { ConnectionManager } from '../ConnectionManager';
import { ApiKeyService } from '../../services/ApiKeyService';
import { ProjectService } from '../../services/ProjectService';
import { WsRateLimiter } from '../WsRateLimiter';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ChannelHandlerRegistry';

/**
 * Handles WebSocket authentication requests.
 * Validates API key and creates a session on successful authentication.
 */
@ChannelMessageHandler('auth', false)
@injectable()
export class AuthHandler implements ChannelHandler<AuthRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  constructor(
    @inject(ConnectionManager) private connectionManager: ConnectionManager,
    @inject(ApiKeyService) private apiKeyService: ApiKeyService,
    @inject(ProjectService) private projectService: ProjectService,
    @inject(WsRateLimiter) private wsRateLimiter: WsRateLimiter
  ) {}

  /**
   * Handles authentication requests.
   * Validates API key against the database and creates a session on successful authentication.
   */
  async handle(context: ChannelHandlerContext, message: AuthRequest): Promise<void> {
    const ip = this.connectionManager.getSocketIp(context.ws);

    // Reject re-authentication on an already-authenticated connection
    if (context.connection) {
      logger.warn({ requestId: message.requestId, sessionId: context.connection.id }, 'Auth message received on already-authenticated connection');
      const response: AuthResponse = { type: 'auth', success: false, error: 'Already authenticated', requestId: message.requestId };
      context.send(context.ws, response);
      return;
    }

    if (!this.wsRateLimiter.tryConsume(ip)) {
      const retryAfter = this.wsRateLimiter.getRetryAfterSeconds(ip);
      logger.warn({ requestId: message.requestId, ip, retryAfter }, 'WebSocket auth rate limit exceeded');
      const response: AuthResponse = { type: 'auth', success: false, error: 'Too many authentication attempts, please try again later', requestId: message.requestId };
      context.send(context.ws, response);
      context.ws.close();
      return;
    }

    try {
      const apiKey = await this.apiKeyService.getApiKeyByKey(message.apiKey);

      if (!apiKey || !apiKey.isActive) {
        logger.warn({ requestId: message.requestId }, 'Authentication failed: invalid or inactive API key');
        const response: AuthResponse = { type: 'auth', success: false, error: 'Invalid or inactive API key', requestId: message.requestId };
        context.send(context.ws, response);
        return;
      }

      const sessionId = this.connectionManager.createSession(context.ws, apiKey.projectId, message.sessionSettings);
      logger.info({ sessionId, projectId: apiKey.projectId, requestId: message.requestId }, 'WebSocket authentication successful, session created');

      const project = await this.projectService.getProjectById(apiKey.projectId);
      const projectSettings = {
        projectId: project.id,
        acceptVoice: project.acceptVoice,
        generateVoice: project.generateVoice,
        asrConfig: project.asrConfig ?? null,
      };

      const response: AuthResponse = { type: 'auth', success: true, sessionId, projectSettings, requestId: message.requestId };
      context.send(context.ws, response);
    } catch (error) {
      logger.error({ error, requestId: message.requestId }, 'Authentication failed: error validating API key');
      const response: AuthResponse = { type: 'auth', success: false, error: 'Invalid API key', requestId: message.requestId };
      context.send(context.ws, response);
    }
  }
}

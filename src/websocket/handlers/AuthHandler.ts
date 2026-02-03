import { inject, injectable } from 'tsyringe';
import type { WebSocketHandler, WebSocketHandlerContext } from '../WebSocketHandler';
import type { AuthRequest, AuthResponse } from '../contracts/auth';
import { ConnectionManager } from '../ConnectionManager';
import { ApiKeyService } from '../../services/ApiKeyService';
import { logger } from '../../utils/logger';
import { WebSocketMessageHandler } from '../WebSocketHandlerRegistry';

/**
 * Handles WebSocket authentication requests.
 * Validates API key and creates a session on successful authentication.
 */
@WebSocketMessageHandler('auth', false)
@injectable()
export class AuthHandler implements WebSocketHandler<AuthRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  constructor(
    @inject(ConnectionManager) private connectionManager: ConnectionManager,
    @inject(ApiKeyService) private apiKeyService: ApiKeyService
  ) {}

  /**
   * Handles authentication requests.
   * Validates API key against the database and creates a session on successful authentication.
   */
  async handle(context: WebSocketHandlerContext, message: AuthRequest): Promise<void> {
    try {
      const apiKey = await this.apiKeyService.getApiKeyByKey(message.apiKey);

      if (!apiKey || !apiKey.isActive) {
        logger.warn({ requestId: message.requestId }, 'Authentication failed: invalid or inactive API key');
        const response: AuthResponse = { type: 'auth', success: false, error: 'Invalid or inactive API key', requestId: message.requestId };
        context.send(context.ws, response);
        return;
      }

      const sessionId = this.connectionManager.createSession(context.ws, apiKey.projectId);
      logger.info({ sessionId, projectId: apiKey.projectId, requestId: message.requestId }, 'WebSocket authentication successful, session created');

      const response: AuthResponse = { type: 'auth', success: true, sessionId, requestId: message.requestId };
      context.send(context.ws, response);
    } catch (error) {
      logger.error({ error, requestId: message.requestId }, 'Authentication failed: error validating API key');
      const response: AuthResponse = { type: 'auth', success: false, error: 'Invalid API key', requestId: message.requestId };
      context.send(context.ws, response);
    }
  }
}

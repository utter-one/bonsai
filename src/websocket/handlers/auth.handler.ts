import { inject, injectable } from 'tsyringe';
import type { MessageHandler, MessageHandlerContext } from './types';
import type { AuthRequest, AuthResponse } from '../../contracts/websocket/auth';
import { ConnectionManager } from '../ConnectionManager';
import { logger } from '../../utils/logger';
import { MessageHandlerFor } from './registry';

/**
 * Handles WebSocket authentication requests.
 * Validates API key and creates a session on successful authentication.
 */
@MessageHandlerFor('auth', false)
@injectable()
export class AuthHandler implements MessageHandler<AuthRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  constructor(@inject(ConnectionManager) private connectionManager: ConnectionManager) {}

  /**
   * Handles authentication requests.
   * Validates API key and creates a session on successful authentication.
   */
  handle(context: MessageHandlerContext, message: AuthRequest): void {
    const expectedApiKey = process.env.WEBSOCKET_API_KEY || process.env.API_KEY;

    if (!expectedApiKey) {
      logger.error('WEBSOCKET_API_KEY or API_KEY environment variable not configured');
      const response: AuthResponse = { type: 'auth', success: false, error: 'Server configuration error', requestId: message.requestId };
      context.send(context.ws, response);
      return;
    }

    if (message.apiKey !== expectedApiKey) {
      logger.warn({ requestId: message.requestId }, 'Authentication failed: invalid API key');
      const response: AuthResponse = { type: 'auth', success: false, error: 'Invalid API key', requestId: message.requestId };
      context.send(context.ws, response);
      return;
    }

    const sessionId = this.connectionManager.createSession(context.ws);
    logger.info({ sessionId, requestId: message.requestId }, 'WebSocket authentication successful, session created');

    const response: AuthResponse = { type: 'auth', success: true, sessionId, requestId: message.requestId };
    context.send(context.ws, response);
  }
}

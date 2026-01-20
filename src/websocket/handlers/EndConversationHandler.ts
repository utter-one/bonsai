import { inject, injectable } from 'tsyringe';
import type { WebSocketHandler, WebSocketHandlerContext } from '../WebSocketHandler';
import type { EndConversationRequest, EndConversationResponse } from '../../contracts/websocket/session';
import { ConnectionManager } from '../ConnectionManager';
import { logger } from '../../utils/logger';
import { WebSocketMessageHandler } from '../WebSocketHandlerRegistry';

/**
 * Handles end conversation requests.
 */
@WebSocketMessageHandler('end_conversation')
@injectable()
export class EndConversationHandler implements WebSocketHandler<EndConversationRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  constructor(@inject(ConnectionManager) private connectionManager: ConnectionManager) {}

  /**
   * Handles end conversation requests.
   */
  handle(context: WebSocketHandlerContext, message: EndConversationRequest): void {
    logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, requestId: message.requestId }, 'End conversation request received');

    try {
      this.connectionManager.detachConversationInSession(message.sessionId);

      const response: EndConversationResponse = { type: 'end_conversation', sessionId: message.sessionId, success: true, requestId: message.requestId };
      context.send(context.connection!.ws, response);

      logger.info({ sessionId: message.sessionId, conversationId: message.conversationId }, 'Conversation ended successfully');
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error), sessionId: message.sessionId, conversationId: message.conversationId }, 'Failed to end conversation');
      const response: EndConversationResponse = { type: 'end_conversation', sessionId: message.sessionId, success: false, error: error instanceof Error ? error.message : 'Failed to end conversation', requestId: message.requestId };
      context.send(context.connection!.ws, response);
    }
  }
}

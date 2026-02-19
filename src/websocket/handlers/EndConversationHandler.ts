import { inject, injectable } from 'tsyringe';
import type { WebSocketHandler, WebSocketHandlerContext } from '../WebSocketHandler';
import type { EndConversationRequest, EndConversationResponse } from '../contracts/session';
import { ConnectionManager } from '../ConnectionManager';
import { logger } from '../../utils/logger';
import { WebSocketMessageHandler } from '../WebSocketHandlerRegistry';
import { ConversationService } from '../../services/ConversationService';

/**
 * Handles end conversation requests.
 */
@WebSocketMessageHandler('end_conversation')
@injectable()
export class EndConversationHandler implements WebSocketHandler<EndConversationRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  constructor(@inject(ConnectionManager) private connectionManager: ConnectionManager,
    @inject(ConversationService) private conversationService: ConversationService) {}

  /**
   * Handles end conversation requests.
   */
  async handle(context: WebSocketHandlerContext, message: EndConversationRequest): Promise<void> {
    logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, requestId: message.requestId }, 'End conversation request received');

    try {
      const connection = context.connection;
      const stageId = connection?.runner?.getRuntimeData()?.stage?.id || '';
      const conversation = connection?.runner?.getRuntimeData()?.conversation;

      // Save event and send WebSocket message BEFORE detaching conversation
      const eventData = { reason: '', stageId, metadata: { currentVariables: conversation?.stageVars?.[stageId] || {} } };
      await this.conversationService.saveConversationEvent(message.conversationId, 'conversation_end', eventData);
      this.connectionManager.sendConversationEvent(message.conversationId, 'conversation_end', eventData);
      
      // Now detach and finish the conversation
      this.connectionManager.detachConversationInSession(message.sessionId);
      await this.conversationService.finishConversation(message.conversationId);

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

import { inject, injectable } from 'tsyringe';
import type { ChannelHandler, ChannelHandlerContext } from '../ChannelHandler';
import type { EndConversationRequest, EndConversationResponse } from '../contracts/session';
import { ConnectionManager } from '../ConnectionManager';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ChannelHandlerRegistry';
import { ConversationService } from '../../services/ConversationService';

/**
 * Handles end conversation requests.
 */
@ChannelMessageHandler('end_conversation')
@injectable()
export class EndConversationHandler implements ChannelHandler<EndConversationRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  constructor(@inject(ConnectionManager) private connectionManager: ConnectionManager,
    @inject(ConversationService) private conversationService: ConversationService) {}

  /**
   * Handles end conversation requests.
   */
  async handle(context: ChannelHandlerContext, message: EndConversationRequest): Promise<void> {
    logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, requestId: message.requestId }, 'End conversation request received');

    try {
      const connection = context.connection;
      const stageId = connection?.runner?.getRuntimeData()?.stage?.id || '';
      const conversation = connection?.runner?.getRuntimeData()?.conversation;
      const projectId = conversation?.projectId || '';

      // Execute __conversation_end lifecycle global action before saving the event
      if (connection?.runner) {
        await connection.runner.executeEndLifecycleAction();
      }

      // Save event and send WebSocket message BEFORE detaching conversation
      const eventData = { reason: '', stageId, metadata: { currentVariables: conversation?.stageVars?.[stageId] || {} } };
      await this.conversationService.saveConversationEvent(projectId, message.conversationId, 'conversation_end', eventData);
      await context.connection?.channel?.sendMessage({ type: 'conversation_event', conversationId: message.conversationId, eventType: 'conversation_end', eventData });
      
      // Now detach and finish the conversation
      this.connectionManager.detachConversationInSession(message.sessionId);
      await this.conversationService.finishConversation(projectId, message.conversationId);

      const response: EndConversationResponse = { type: 'end_conversation', sessionId: message.sessionId, success: true, requestId: message.requestId };
      context.send(context.ws, response);

      logger.info({ sessionId: message.sessionId, conversationId: message.conversationId }, 'Conversation ended successfully');
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error), sessionId: message.sessionId, conversationId: message.conversationId }, 'Failed to end conversation');
      const response: EndConversationResponse = { type: 'end_conversation', sessionId: message.sessionId, success: false, error: error instanceof Error ? error.message : 'Failed to end conversation', requestId: message.requestId };
      context.send(context.ws, response);
    }
  }
}

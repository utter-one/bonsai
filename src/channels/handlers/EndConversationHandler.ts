import { inject, injectable } from 'tsyringe';
import type { ChannelHandler } from '../ChannelHandler';
import type { ChannelHandlerContext } from '../ChannelHandlerContext';
import type { CALEndConversationRequest, CALEndConversationResponse } from '../messages';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ChannelHandlerRegistry';
import { ConversationService } from '../../services/ConversationService';
import { ConnectionManager } from '../../websocket/ConnectionManager';

/**
 * Handles end conversation requests.
 */
@ChannelMessageHandler('end_conversation')
@injectable()
export class EndConversationHandler implements ChannelHandler<CALEndConversationRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  constructor(@inject(ConnectionManager) private connectionManager: ConnectionManager,
    @inject(ConversationService) private conversationService: ConversationService) {}

  /**
   * Handles end conversation requests.
   */
  async handle(context: ChannelHandlerContext, message: CALEndConversationRequest): Promise<void> {
    logger.info({ sessionId: context.connection?.id, conversationId: message.conversationId, correlationId: message.correlationId }, 'End conversation request received');

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
      this.connectionManager.detachConversationFromConnection(context.connection!.id);
      await this.conversationService.finishConversation(projectId, message.conversationId);

      const response: CALEndConversationResponse = { 
        type: 'end_conversation',
        conversationId: message.conversationId, 
        success: true, 
        correlationId: message.correlationId };
      context.send(response);

      logger.info({ sessionId: context.connection?.id, conversationId: message.conversationId }, 'Conversation ended successfully');
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error), sessionId: context.connection?.id, conversationId: message.conversationId }, 'Failed to end conversation');
      const response: CALEndConversationResponse = { 
        type: 'end_conversation', 
        success: false, 
        conversationId: message.conversationId,
        correlationId: message.correlationId,
        error: error instanceof Error ? error.message : 'Failed to end conversation' };
      context.send(response);
    }
  }
}

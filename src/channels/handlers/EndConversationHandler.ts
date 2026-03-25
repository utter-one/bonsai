import { inject, injectable } from 'tsyringe';
import type { ClientMessageHandler } from '../ClientMessageHandler';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import { calEndConversationRequestSchema } from '../messages';
import type { CALEndConversationRequest, CALEndConversationResponse } from '../messages';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ClientMessageHandlerRegistry';
import { ConversationService } from '../../services/ConversationService';
import { SessionManager } from '../SessionManager';

/**
 * Handles end conversation requests.
 */
@ChannelMessageHandler('end_conversation', true, calEndConversationRequestSchema, 'conversation_control')
@injectable()
export class EndConversationHandler implements ClientMessageHandler<CALEndConversationRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  constructor(@inject(SessionManager) private sessionManager: SessionManager,
    @inject(ConversationService) private conversationService: ConversationService) {}

  /**
   * Handles end conversation requests.
   */
  async handle(context: ClientMessageHandlerContext, message: CALEndConversationRequest): Promise<void> {
    logger.info({ sessionId: context.session?.id, conversationId: message.conversationId, correlationId: message.correlationId }, 'End conversation request received');

    try {
      const session = context.session;
      const stageId = session?.runner?.getRuntimeData()?.stage?.id || '';
      const conversation = session?.runner?.getRuntimeData()?.conversation;
      const projectId = conversation?.projectId || '';

      // Execute __conversation_end lifecycle global action before saving the event
      if (session?.runner) {
        await session.runner.executeEndLifecycleAction();
      }

      // Save event and send WebSocket message BEFORE detaching conversation
      const eventData = { reason: '', stageId, metadata: { currentVariables: conversation?.stageVars?.[stageId] || {} } };
      await this.conversationService.saveConversationEvent(projectId, message.conversationId, 'conversation_end', eventData);
      await context.session?.clientConnection?.sendMessage({ type: 'conversation_event', conversationId: message.conversationId, eventType: 'conversation_end', eventData });
      
      // Now detach and finish the conversation
      this.sessionManager.detachConversationFromSession(context.session!.id);
      await this.conversationService.finishConversation(projectId, message.conversationId);

      const response: CALEndConversationResponse = { 
        type: 'end_conversation',
        conversationId: message.conversationId, 
        success: true, 
        correlationId: message.correlationId };
      context.send(response);

      logger.info({ sessionId: context.session?.id, conversationId: message.conversationId }, 'Conversation ended successfully');
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error), sessionId: context.session?.id, conversationId: message.conversationId }, 'Failed to end conversation');
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

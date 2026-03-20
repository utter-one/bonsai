import { inject, injectable } from 'tsyringe';
import type { ChannelHandler, ChannelHandlerContext } from '../channel';
import type { CALResumeConversationRequest, CALResumeConversationResponse } from '../messages';
import { ConnectionManager } from '../../websocket/ConnectionManager';
import { ConversationService } from '../../services/ConversationService';
import { NotFoundError, InvalidOperationError, ArchivedProjectError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ChannelHandlerRegistry';
import type { ConversationFailedEventData } from '../../types/conversationEvents';

/**
 * Handles resume conversation requests.
 */
@ChannelMessageHandler('resume_conversation')
@injectable()
export class ResumeConversationHandler implements ChannelHandler<CALResumeConversationRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  constructor(@inject(ConnectionManager) private connectionManager: ConnectionManager, @inject(ConversationService) private conversationService: ConversationService) { }

  /**
   * Handles resume conversation requests.
   */
  async handle(context: ChannelHandlerContext, message: CALResumeConversationRequest): Promise<void> {
    logger.info({ sessionId: context.connection?.id, conversationId: message.conversationId, correlationId: message.correlationId }, 'Resume conversation request received');

    if (!context.connection) {
      throw new NotFoundError('Session not found');
    }

    if (context.connection.conversationId) {
      throw new InvalidOperationError('A conversation is already active in this session');
    }

    const conversation = await this.conversationService.getConversationById(context.connection.projectId, message.conversationId);
    if (!conversation) {
      throw new NotFoundError('Conversation not found');
    }

    // Validate that the conversation belongs to the project the API key is authorized for
    if (conversation.projectId !== context.connection.projectId) {
      throw new NotFoundError('Conversation not found');
    }

    if (conversation.archived) {
      throw new ArchivedProjectError('Cannot resume a conversation belonging to an archived project');
    }

    await this.connectionManager.attachConversationToSession(context.connection.id, message.conversationId);

    // Return success response
    const response: CALResumeConversationResponse = { type: 'resume_conversation', conversationId: message.conversationId, correlationId: message.correlationId, success: true };
    context.send(response);

    // Resume the conversation
    try {
      await context.connection.runner.resumeConversation();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to resume conversation';
      logger.error({ error: errorMessage, sessionId: context.connection?.id, conversationId: message.conversationId }, 'Failed to resume conversation');
      const failedEventData: ConversationFailedEventData = { reason: errorMessage, stageId: conversation.stageId };
      try {
        await this.conversationService.failConversation(context.connection!.projectId, message.conversationId, errorMessage);
        await this.conversationService.saveConversationEvent(context.connection!.projectId, message.conversationId, 'conversation_failed', failedEventData);
        await context.connection!.channel?.sendMessage({ type: 'conversation_event', conversationId: message.conversationId, eventType: 'conversation_failed', eventData: failedEventData });
      } catch (cleanupError) {
        logger.error({ error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError), conversationId: message.conversationId }, 'Failed to save conversation_failed event during cleanup');
      }
      this.connectionManager.detachConversationInSession(context.connection.id);
    }
  }
}

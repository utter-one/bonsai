import { inject, injectable } from 'tsyringe';
import type { ClientMessageHandler } from '../ClientMessageHandler';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import { calResumeConversationRequestSchema } from '../messages';
import type { CALResumeConversationRequest, CALResumeConversationResponse } from '../messages';
import { SessionManager } from '../SessionManager';
import { ConversationService } from '../../services/ConversationService';
import { NotFoundError, InvalidOperationError, ArchivedProjectError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ClientMessageHandlerRegistry';
import type { ConversationFailedEventData } from '../../types/conversationEvents';

/**
 * Handles resume conversation requests.
 */
@ChannelMessageHandler('resume_conversation', true, calResumeConversationRequestSchema, 'conversation_control')
@injectable()
export class ResumeConversationHandler implements ClientMessageHandler<CALResumeConversationRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  constructor(@inject(SessionManager) private sessionManager: SessionManager, @inject(ConversationService) private conversationService: ConversationService) { }

  /**
   * Handles resume conversation requests.
   */
  async handle(context: ClientMessageHandlerContext, message: CALResumeConversationRequest): Promise<void> {
    logger.info({ sessionId: context.session?.id, conversationId: message.conversationId, correlationId: message.correlationId }, 'Resume conversation request received');

    if (!context.session) {
      throw new NotFoundError('Session not found');
    }

    if (context.session.conversationId) {
      throw new InvalidOperationError('A conversation is already active in this session');
    }

    if (!message.conversationId) {
      throw new InvalidOperationError('conversationId is required to resume a conversation');
    }

    const conversation = await this.conversationService.getConversationById(context.session.projectId, message.conversationId);
    if (!conversation) {
      throw new NotFoundError('Conversation not found');
    }

    // Validate that the conversation belongs to the project the API key is authorized for
    if (conversation.projectId !== context.session.projectId) {
      throw new NotFoundError('Conversation not found');
    }

    if (conversation.archived) {
      throw new ArchivedProjectError('Cannot resume an archived conversation');
    }

    try {
      await this.sessionManager.attachConversationToSession(context.session.id, message.conversationId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to attach conversation to session';
      logger.error({ error: errorMessage, sessionId: context.session.id, conversationId: message.conversationId }, 'Failed to attach conversation to session');
      throw error;
    }

    if (!context.session.runner) {
      throw new InvalidOperationError('No active conversation runner');
    }

    // Resume the conversation
    try {
      await context.session.runner.resumeConversation();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to resume conversation';
      logger.error({ error: errorMessage, sessionId: context.session.id, conversationId: message.conversationId }, 'Failed to resume conversation');
      const failedEventData: ConversationFailedEventData = { reason: errorMessage, stageId: conversation.stageId };
      const clientEventData: ConversationFailedEventData = { reason: 'Failed to resume conversation', stageId: conversation.stageId };
      try {
        await this.conversationService.failConversation(context.session.projectId, message.conversationId, errorMessage);
        await this.conversationService.saveConversationEvent(context.session.projectId, message.conversationId, 'conversation_failed', failedEventData, conversation.stageId);
        await context.session.clientConnection?.sendMessage({ type: 'conversation_event', conversationId: message.conversationId, eventType: 'conversation_failed', eventData: clientEventData });
      } catch (cleanupError) {
        logger.error({ error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError), conversationId: message.conversationId }, 'Failed to save conversation_failed event during cleanup');
      }
      await this.sessionManager.detachConversationFromSession(context.session.id);
      const response: CALResumeConversationResponse = { type: 'resume_conversation', conversationId: message.conversationId, correlationId: message.correlationId, success: false, error: 'Failed to resume conversation' };
      context.send(response);
      return;
    }

    const response: CALResumeConversationResponse = { type: 'resume_conversation', conversationId: message.conversationId, correlationId: message.correlationId, success: true };
    context.send(response);
  }
}

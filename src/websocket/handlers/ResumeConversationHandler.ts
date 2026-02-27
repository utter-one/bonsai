import { inject, injectable } from 'tsyringe';
import type { WebSocketHandler, WebSocketHandlerContext } from '../WebSocketHandler';
import type { ResumeConversationRequest, ResumeConversationResponse } from '../contracts/session';
import { ConnectionManager } from '../ConnectionManager';
import { ConversationService } from '../../services/ConversationService';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { WebSocketMessageHandler } from '../WebSocketHandlerRegistry';

/**
 * Handles resume conversation requests.
 */
@WebSocketMessageHandler('resume_conversation')
@injectable()
export class ResumeConversationHandler implements WebSocketHandler<ResumeConversationRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  constructor(@inject(ConnectionManager) private connectionManager: ConnectionManager, @inject(ConversationService) private conversationService: ConversationService) {}

  /**
   * Handles resume conversation requests.
   */
  async handle(context: WebSocketHandlerContext, message: ResumeConversationRequest): Promise<void> {
    logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, requestId: message.requestId }, 'Resume conversation request received');
    
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

    this.connectionManager.attachConversationToSession(message.sessionId, message.conversationId);

    // Return success response
    const response: ResumeConversationResponse = { type: 'resume_conversation', sessionId: message.sessionId, success: true, requestId: message.requestId };
    context.send(context.connection.ws, response);

    // Resume the conversation
    await context.connection.runner.resumeConversation();
  }
}

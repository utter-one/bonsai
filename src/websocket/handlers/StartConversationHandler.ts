import { inject, injectable } from 'tsyringe';
import type { WebSocketHandler, WebSocketHandlerContext } from '../WebSocketHandler';
import type { StartConversationRequest, StartConversationResponse } from '../contracts/session';
import { ConnectionManager } from '../ConnectionManager';
import { ConversationService } from '../../services/ConversationService';
import { StageService } from '../../services/StageService';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { WebSocketMessageHandler } from '../WebSocketHandlerRegistry';
import { UserService } from '../../services/UserService';

/**
 * Handles start conversation requests.
 */
@WebSocketMessageHandler('start_conversation')
@injectable()
export class StartConversationHandler implements WebSocketHandler<StartConversationRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  constructor(@inject(ConnectionManager) private connectionManager: ConnectionManager, 
    @inject(ConversationService) private conversationService: ConversationService, 
    @inject(UserService) private userService: UserService,
    @inject(StageService) private stageService: StageService) {}

  /**
   * Handles start conversation requests.
   */
  async handle(context: WebSocketHandlerContext, message: StartConversationRequest): Promise<void> {
    logger.info({ sessionId: message.sessionId, personaId: message.personaId, requestId: message.requestId }, 'Start conversation request received');
    
    if (!context.connection) {
      throw new NotFoundError('Session not found');
    }
    
    if (context.connection.conversationId) {
      throw new InvalidOperationError('A conversation is already active in this session');
    }

    try {
      // Check if user exists
      const user = await this.userService.getUserById(message.userId);
      if (!user) {
        throw new NotFoundError('User not found');
      }
      
      // Get stage to extract projectId
      const stage = await this.stageService.getStageById(message.stageId);

      // Validate that the stage belongs to the project the API key is authorized for
      if (stage.projectId !== context.connection.projectId) {
        throw new NotFoundError('Stage not found');
      }
      
      const conversation = await this.conversationService.createConversation({ projectId: stage.projectId, userId: message.userId, stageId: message.stageId, clientId: context.connection.id, status: 'initialized' });
      const conversationId = conversation.id;

      await this.connectionManager.attachConversationToSession(message.sessionId, conversationId);

      logger.info({ sessionId: message.sessionId, conversationId }, 'Conversation created and attached to session');

      const response: StartConversationResponse = { type: 'start_conversation', sessionId: message.sessionId, success: true, conversationId, requestId: message.requestId };
      context.send(context.connection.ws, response);

      // Start the conversation
      await context.connection.runner.startConversation();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create conversation';
      logger.error({ error: errorMessage, sessionId: message.sessionId }, 'Failed to create conversation');
      const response: StartConversationResponse = { type: 'start_conversation', sessionId: message.sessionId, success: false, error: errorMessage, requestId: message.requestId };
      context.send(context.connection.ws, response);
    }
  }
}

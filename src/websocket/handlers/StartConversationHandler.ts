import { inject, injectable } from 'tsyringe';
import type { WebSocketHandler, WebSocketHandlerContext } from '../WebSocketHandler';
import type { StartConversationRequest, StartConversationResponse } from '../contracts/session';
import { ConnectionManager } from '../ConnectionManager';
import { ConversationService } from '../../services/ConversationService';
import { StageService } from '../../services/StageService';
import { ProjectService } from '../../services/ProjectService';
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
    @inject(StageService) private stageService: StageService,
    @inject(ProjectService) private projectService: ProjectService) {}

  /**
   * Handles start conversation requests.
   */
  async handle(context: WebSocketHandlerContext, message: StartConversationRequest): Promise<void> {
    logger.info({ sessionId: message.sessionId, agentId: message.agentId, requestId: message.requestId }, 'Start conversation request received');
    
    if (!context.connection) {
      throw new NotFoundError('Session not found');
    }
    
    if (context.connection.conversationId) {
      throw new InvalidOperationError('A conversation is already active in this session');
    }

    try {
      // Get project first to check autoCreateUsers flag and resolve timezone later
      const project = await this.projectService.getProjectById(context.connection.projectId);

      // Look up the user; auto-create if the project allows it
      let user;
      try {
        user = await this.userService.getUserById(context.connection.projectId, message.userId);
      } catch (userError) {
        if (userError instanceof NotFoundError && project.autoCreateUsers) {
          user = await this.userService.ensureUserExists(context.connection.projectId, message.userId);
        } else {
          throw userError;
        }
      }
      
      // Get stage to extract projectId
      const stage = await this.stageService.getStageById(context.connection.projectId, message.stageId);

      // Validate that the stage belongs to the project the API key is authorized for
      if (stage.projectId !== context.connection.projectId) {
        throw new NotFoundError('Stage not found');
      }

      // Resolve timezone with 4-level precedence: message > userProfile > project > null (UTC fallback at render time)
      const profileTimezone = user.profile.timezone as string | undefined;
      const resolvedTimezone = message.timezone ?? profileTimezone ?? project.timezone ?? null;

      const conversation = await this.conversationService.createConversation({ projectId: stage.projectId, userId: message.userId, stageId: message.stageId, clientId: context.connection.id, status: 'initialized', metadata: resolvedTimezone ? { timezone: resolvedTimezone } : null });
      const conversationId = conversation.id;

      await this.connectionManager.attachConversationToSession(message.sessionId, conversationId);

      logger.info({ sessionId: message.sessionId, conversationId }, 'Conversation created and attached to session');

      // Start the conversation
      await context.connection.runner.startConversation();

      const response: StartConversationResponse = { type: 'start_conversation', sessionId: message.sessionId, success: true, conversationId, requestId: message.requestId };
      context.send(context.connection.ws, response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create conversation';
      logger.error({ error: errorMessage, sessionId: message.sessionId }, 'Failed to create conversation');
      const response: StartConversationResponse = { type: 'start_conversation', sessionId: message.sessionId, success: false, error: errorMessage, requestId: message.requestId };
      context.send(context.connection.ws, response);
    }
  }
}

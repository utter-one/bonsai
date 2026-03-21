import { inject, injectable } from 'tsyringe';
import type { ChannelHandler } from '../ChannelHandler';
import type { ChannelHandlerContext } from '../ChannelHandlerContext';
import type { CALStartConversationRequest, CALStartConversationResponse } from '../messages';
import { ConnectionManager } from '../../websocket/ConnectionManager';
import { ConversationService } from '../../services/ConversationService';
import { StageService } from '../../services/StageService';
import { ProjectService } from '../../services/ProjectService';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ChannelHandlerRegistry';
import { UserService } from '../../services/UserService';
import type { ConversationFailedEventData } from '../../types/conversationEvents';

/**
 * Handles start conversation requests.
 */
@ChannelMessageHandler('start_conversation')
@injectable()
export class StartConversationHandler implements ChannelHandler<CALStartConversationRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  constructor(@inject(ConnectionManager) private connectionManager: ConnectionManager,
    @inject(ConversationService) private conversationService: ConversationService,
    @inject(UserService) private userService: UserService,
    @inject(StageService) private stageService: StageService,
    @inject(ProjectService) private projectService: ProjectService) { }

  /**
   * Handles start conversation requests.
   */
  async handle(context: ChannelHandlerContext, message: CALStartConversationRequest): Promise<void> {
    logger.info({ sessionId: context.connection?.id, agentId: message.agentId, correlationId: message.correlationId }, 'Start conversation request received');

    if (!context.connection) {
      throw new NotFoundError('Session not found');
    }

    if (context.connection.conversationId) {
      throw new InvalidOperationError('A conversation is already active in this session');
    }

    let conversationId: string | undefined;
    let conversationAttached = false;

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
      conversationId = conversation.id;

      await this.connectionManager.attachConversationToSession(context.connection.id, conversationId);
      conversationAttached = true;

      logger.info({ sessionId: context.connection?.id, conversationId }, 'Conversation created and attached to session');

      // Start the conversation
      await context.connection.runner.startConversation();

      const response: CALStartConversationResponse = { type: 'start_conversation', conversationId, correlationId: message.correlationId, success: true };
      context.send(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start conversation';
      logger.error({ error: errorMessage, sessionId: context.connection?.id, conversationId }, 'Failed to start conversation');

      if (conversationAttached && conversationId) {
        const failedEventData: ConversationFailedEventData = { reason: errorMessage, stageId: message.stageId };
        try {
          await this.conversationService.failConversation(context.connection!.projectId, conversationId, errorMessage);
          await this.conversationService.saveConversationEvent(context.connection!.projectId, conversationId, 'conversation_failed', failedEventData);
          await context.connection!.channel?.sendMessage({ type: 'conversation_event', conversationId, eventType: 'conversation_failed', eventData: failedEventData });
        } catch (cleanupError) {
          logger.error({ error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError), conversationId }, 'Failed to save conversation_failed event during cleanup');
        }
        this.connectionManager.detachConversationInSession(context.connection.id);
      }

      const response: CALStartConversationResponse = { type: 'start_conversation', conversationId: conversationId ?? '', correlationId: message.correlationId, success: false, error: errorMessage };
      context.send(response);
    }
  }
}

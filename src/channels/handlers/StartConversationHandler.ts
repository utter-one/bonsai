import { inject, injectable } from 'tsyringe';
import type { ClientMessageHandler } from '../ClientMessageHandler';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import { calStartConversationRequestSchema } from '../messages';
import type { CALStartConversationRequest, CALStartConversationResponse } from '../messages';
import { SessionManager } from '../SessionManager';
import { ConversationService } from '../../services/ConversationService';
import { StageService } from '../../services/StageService';
import { ProjectService } from '../../services/ProjectService';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ClientMessageHandlerRegistry';
import { UserService } from '../../services/UserService';
import type { ConversationFailedEventData } from '../../types/conversationEvents';

/**
 * Handles start conversation requests.
 */
@ChannelMessageHandler('start_conversation', true, calStartConversationRequestSchema)
@injectable()
export class StartConversationHandler implements ClientMessageHandler<CALStartConversationRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  constructor(@inject(SessionManager) private sessionManager: SessionManager,
    @inject(ConversationService) private conversationService: ConversationService,
    @inject(UserService) private userService: UserService,
    @inject(StageService) private stageService: StageService,
    @inject(ProjectService) private projectService: ProjectService) { }

  /**
   * Handles start conversation requests.
   */
  async handle(context: ClientMessageHandlerContext, message: CALStartConversationRequest): Promise<void> {
    logger.info({ sessionId: context.session?.id, agentId: message.agentId, correlationId: message.correlationId }, 'Start conversation request received');

    if (!context.session) {
      throw new NotFoundError('Session not found');
    }

    if (context.session.conversationId) {
      throw new InvalidOperationError('A conversation is already active in this session');
    }

    let conversationId: string | undefined;
    let conversationAttached = false;

    try {
      // Get project first to check autoCreateUsers flag and resolve timezone later
      const project = await this.projectService.getProjectById(context.session.projectId);

      // Look up the user; auto-create if the project allows it
      let user;
      try {
        user = await this.userService.getUserById(context.session.projectId, message.userId);
      } catch (userError) {
        if (userError instanceof NotFoundError && project.autoCreateUsers) {
          user = await this.userService.ensureUserExists(context.session.projectId, message.userId);
        } else {
          throw userError;
        }
      }

      // Get stage to extract projectId
      const stage = await this.stageService.getStageById(context.session.projectId, message.stageId);

      // Validate that the stage belongs to the project the API key is authorized for
      if (stage.projectId !== context.session.projectId) {
        throw new NotFoundError('Stage not found');
      }

      // Resolve timezone with 4-level precedence: message > userProfile > project > null (UTC fallback at render time)
      const profileTimezone = user.profile.timezone as string | undefined;
      const resolvedTimezone = message.timezone ?? profileTimezone ?? project.timezone ?? null;

      const conversation = await this.conversationService.createConversation({ projectId: stage.projectId, userId: message.userId, stageId: message.stageId, sessionId: context.session.id, status: 'initialized', metadata: resolvedTimezone ? { timezone: resolvedTimezone } : null });
      conversationId = conversation.id;

      await this.sessionManager.attachConversationToSession(context.session.id, conversationId);
      conversationAttached = true;

      logger.info({ sessionId: context.session?.id, conversationId }, 'Conversation created and attached to session');

      // Start the conversation
      await context.session.runner.startConversation();

      const response: CALStartConversationResponse = { type: 'start_conversation', conversationId, correlationId: message.correlationId, success: true };
      context.send(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start conversation';
      logger.error({ error: errorMessage, sessionId: context.session?.id, conversationId }, 'Failed to start conversation');

      if (conversationAttached && conversationId) {
        const failedEventData: ConversationFailedEventData = { reason: errorMessage, stageId: message.stageId };
        try {
          await this.conversationService.failConversation(context.session!.projectId, conversationId, errorMessage);
          await this.conversationService.saveConversationEvent(context.session!.projectId, conversationId, 'conversation_failed', failedEventData);
          await context.session!.clientConnection?.sendMessage({ type: 'conversation_event', conversationId, eventType: 'conversation_failed', eventData: failedEventData });
        } catch (cleanupError) {
          logger.error({ error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError), conversationId }, 'Failed to save conversation_failed event during cleanup');
        }
        this.sessionManager.detachConversationFromSession(context.session.id);
      }

      const response: CALStartConversationResponse = { type: 'start_conversation', conversationId: conversationId ?? '', correlationId: message.correlationId, success: false, error: errorMessage };
      context.send(response);
    }
  }
}

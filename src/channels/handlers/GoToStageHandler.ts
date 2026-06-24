import { injectable } from 'tsyringe';
import type { ClientMessageHandler } from '../ClientMessageHandler';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import { calGoToStageRequestSchema } from '../messages';
import type { CALGoToStageRequest, CALGoToStageResponse } from '../messages';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ClientMessageHandlerRegistry';

/**
 * Handles go to stage requests.
 */
@ChannelMessageHandler('go_to_stage', true, calGoToStageRequestSchema, 'stage_control')
@injectable()
export class GoToStageHandler implements ClientMessageHandler<CALGoToStageRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles go to stage requests.
   */
  async handle(context: ClientMessageHandlerContext, message: CALGoToStageRequest): Promise<void> {
    logger.info({ sessionId: context.session?.id, conversationId: message.conversationId, stageId: message.stageId, correlationId: message.correlationId }, 'Go to stage request received');

    try {
      if (!context.session) {
        throw new NotFoundError('Session not found');
      }

      if (!context.session.conversationId) {
        throw new InvalidOperationError('No active conversation in this session');
      }

      if (context.session.conversationId !== message.conversationId) {
        throw new InvalidOperationError('Conversation ID mismatch');
      }

      if (!message.stageId) {
        throw new InvalidOperationError('Stage ID is required');
      }

      if (!context.session.runner) {
        throw new InvalidOperationError('No active conversation runner');
      }

      await context.session.runner.goToStage(message.stageId);
      await context.session.runner.saveCommandEvent('go_to_stage', { stageId: message.stageId });

      const response: CALGoToStageResponse = { type: 'go_to_stage', conversationId: message.conversationId, correlationId: message.correlationId, success: true };
      context.send(response);

      logger.info({ sessionId: context.session?.id, conversationId: message.conversationId, stageId: message.stageId }, 'Go to stage completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to navigate to stage';
      const sanitizedError = 'Failed to navigate to stage';
      logger.error({ error: errorMessage, sessionId: context.session?.id, conversationId: message.conversationId, stageId: message.stageId }, 'Failed to go to stage');
      const response: CALGoToStageResponse = { type: 'go_to_stage', conversationId: message.conversationId, correlationId: message.correlationId, success: false, error: sanitizedError };
      context.send(response);
    }
  }
}

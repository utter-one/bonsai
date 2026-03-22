import { injectable } from 'tsyringe';
import type { ClientMessageHandler } from '../ClientMessageHandler';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import type { CALGoToStageRequest, CALGoToStageResponse } from '../messages';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ClientMessageHandlerRegistry';

/**
 * Handles go to stage requests.
 */
@ChannelMessageHandler('go_to_stage')
@injectable()
export class GoToStageHandler implements ClientMessageHandler<CALGoToStageRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles go to stage requests.
   */
  async handle(context: ClientMessageHandlerContext, message: CALGoToStageRequest): Promise<void> {
    logger.info({ sessionId: context.connection?.id, conversationId: message.conversationId, stageId: message.stageId, correlationId: message.correlationId }, 'Go to stage request received');

    try {
      if (!context.connection) {
        throw new NotFoundError('Session not found');
      }

      if (!context.connection.conversationId) {
        throw new InvalidOperationError('No active conversation in this session');
      }

      if (context.connection.conversationId !== message.conversationId) {
        throw new InvalidOperationError('Conversation ID mismatch');
      }

      await context.connection.runner.saveCommandEvent('go_to_stage', { stageId: message.stageId });
      await context.connection.runner.goToStage(message.stageId);

      const response: CALGoToStageResponse = { type: 'go_to_stage', conversationId: message.conversationId, correlationId: message.correlationId, success: true };
      context.send(response);

      logger.info({ sessionId: context.connection?.id, conversationId: message.conversationId, stageId: message.stageId }, 'Go to stage completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to navigate to stage';
      logger.error({ error: errorMessage, sessionId: context.connection?.id, conversationId: message.conversationId, stageId: message.stageId }, 'Failed to go to stage');
      const response: CALGoToStageResponse = { type: 'go_to_stage', conversationId: message.conversationId, correlationId: message.correlationId, success: false, error: errorMessage };
      context.send(response);
    }
  }
}

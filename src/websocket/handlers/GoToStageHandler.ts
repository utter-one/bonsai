import { injectable } from 'tsyringe';
import type { WebSocketHandler, WebSocketHandlerContext } from '../WebSocketHandler';
import type { GoToStageRequest, GoToStageResponse } from '../contracts/command';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { WebSocketMessageHandler } from '../WebSocketHandlerRegistry';

/**
 * Handles go to stage requests.
 */
@WebSocketMessageHandler('go_to_stage')
@injectable()
export class GoToStageHandler implements WebSocketHandler<GoToStageRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles go to stage requests.
   */
  async handle(context: WebSocketHandlerContext, message: GoToStageRequest): Promise<void> {
    logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, stageId: message.stageId, requestId: message.requestId }, 'Go to stage request received');

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

      const response: GoToStageResponse = { type: 'go_to_stage', sessionId: message.sessionId, success: true, requestId: message.requestId };
      context.send(context.connection.ws, response);

      logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, stageId: message.stageId }, 'Go to stage completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to navigate to stage';
      logger.error({ error: errorMessage, sessionId: message.sessionId, conversationId: message.conversationId, stageId: message.stageId }, 'Failed to go to stage');
      const response: GoToStageResponse = { type: 'go_to_stage', sessionId: message.sessionId, success: false, error: errorMessage, requestId: message.requestId };
      context.send(context.connection!.ws, response);
    }
  }
}

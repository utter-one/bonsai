import { injectable } from 'tsyringe';
import type { ChannelHandler, ChannelHandlerContext } from '../channel';
import type { CALRunActionRequest, CALRunActionResponse } from '../messages';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ChannelHandlerRegistry';

/**
 * Handles run action requests.
 */
@ChannelMessageHandler('run_action')
@injectable()
export class RunActionHandler implements ChannelHandler<CALRunActionRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles run action requests.
   */
  async handle(context: ChannelHandlerContext, message: CALRunActionRequest): Promise<void> {
    logger.info({ sessionId: context.connection?.id, conversationId: message.conversationId, actionName: message.actionName, correlationId: message.correlationId }, 'Run action request received');

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

      await context.connection.runner.saveCommandEvent('run_action', { actionName: message.actionName, parameters: message.parameters });
      const result = await context.connection.runner.runAction(message.actionName, message.parameters);

      const response: CALRunActionResponse = { type: 'run_action', conversationId: message.conversationId, correlationId: message.correlationId, success: true, result };
      context.send(response);

      logger.info({ sessionId: context.connection?.id, conversationId: message.conversationId, actionName: message.actionName }, 'Run action completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to run action';
      logger.error({ error: errorMessage, sessionId: context.connection?.id, conversationId: message.conversationId, actionName: message.actionName }, 'Failed to run action');
      const response: CALRunActionResponse = { type: 'run_action', conversationId: message.conversationId, correlationId: message.correlationId, success: false, error: errorMessage };
      context.send(response);
    }
  }
}

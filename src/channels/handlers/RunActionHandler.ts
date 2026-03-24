import { injectable } from 'tsyringe';
import type { ClientMessageHandler } from '../ClientMessageHandler';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import { calRunActionRequestSchema } from '../messages';
import type { CALRunActionRequest, CALRunActionResponse } from '../messages';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ClientMessageHandlerRegistry';

/**
 * Handles run action requests.
 */
@ChannelMessageHandler('run_action', true, calRunActionRequestSchema)
@injectable()
export class RunActionHandler implements ClientMessageHandler<CALRunActionRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles run action requests.
   */
  async handle(context: ClientMessageHandlerContext, message: CALRunActionRequest): Promise<void> {
    logger.info({ sessionId: context.session?.id, conversationId: message.conversationId, actionName: message.actionName, correlationId: message.correlationId }, 'Run action request received');

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

      await context.session.runner.saveCommandEvent('run_action', { actionName: message.actionName, parameters: message.parameters });
      const result = await context.session.runner.runAction(message.actionName, message.parameters);

      const response: CALRunActionResponse = { type: 'run_action', conversationId: message.conversationId, correlationId: message.correlationId, success: true, result };
      context.send(response);

      logger.info({ sessionId: context.session?.id, conversationId: message.conversationId, actionName: message.actionName }, 'Run action completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to run action';
      logger.error({ error: errorMessage, sessionId: context.session?.id, conversationId: message.conversationId, actionName: message.actionName }, 'Failed to run action');
      const response: CALRunActionResponse = { type: 'run_action', conversationId: message.conversationId, correlationId: message.correlationId, success: false, error: errorMessage };
      context.send(response);
    }
  }
}

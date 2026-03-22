import { injectable } from 'tsyringe';
import type { ClientMessageHandler } from '../ClientMessageHandler';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import type { CALGetAllVarsRequest, CALGetAllVarsResponse } from '../messages';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ClientMessageHandlerRegistry';

/**
 * Handles get all variables requests.
 */
@ChannelMessageHandler('get_all_vars')
@injectable()
export class GetAllVarsHandler implements ClientMessageHandler<CALGetAllVarsRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles get all variables requests.
   */
  async handle(context: ClientMessageHandlerContext, message: CALGetAllVarsRequest): Promise<void> {
    logger.info({ sessionId: context.connection?.id, conversationId: message.conversationId, stageId: message.stageId, correlationId: message.correlationId }, 'Get all variables request received');

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

      await context.connection.runner.saveCommandEvent('get_all_vars', { stageId: message.stageId });
      const variables = await context.connection.runner.getAllVariables(message.stageId);

      const response: CALGetAllVarsResponse = { type: 'get_all_vars', conversationId: message.conversationId, correlationId: message.correlationId, success: true, variables };
      context.send(response);

      logger.info({ sessionId: context.connection?.id, conversationId: message.conversationId, stageId: message.stageId }, 'Get all variables completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get all variables';
      logger.error({ error: errorMessage, sessionId: context.connection?.id, conversationId: message.conversationId, stageId: message.stageId }, 'Failed to get all variables');
      const response: CALGetAllVarsResponse = { type: 'get_all_vars', conversationId: message.conversationId, correlationId: message.correlationId, success: false, variables: {}, error: errorMessage };
      context.send(response);
    }
  }
}

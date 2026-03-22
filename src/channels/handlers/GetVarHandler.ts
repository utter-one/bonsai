import { injectable } from 'tsyringe';
import type { ClientMessageHandler } from '../ClientMessageHandler';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import type { CALGetVarRequest, CALGetVarResponse } from '../messages';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ClientMessageHandlerRegistry';

/**
 * Handles get variable requests.
 */
@ChannelMessageHandler('get_var')
@injectable()
export class GetVarHandler implements ClientMessageHandler<CALGetVarRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles get variable requests.
   */
  async handle(context: ClientMessageHandlerContext, message: CALGetVarRequest): Promise<void> {
    logger.info({ sessionId: context.connection?.id, conversationId: message.conversationId, stageId: message.stageId, variableName: message.variableName, correlationId: message.correlationId }, 'Get variable request received');

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

      await context.connection.runner.saveCommandEvent('get_var', { stageId: message.stageId, variableName: message.variableName });
      const variableValue = await context.connection.runner.getVariable(message.stageId, message.variableName);

      const response: CALGetVarResponse = { type: 'get_var', conversationId: message.conversationId, correlationId: message.correlationId, success: true, variableName: message.variableName, variableValue };
      context.send(response);

      logger.info({ sessionId: context.connection?.id, conversationId: message.conversationId, stageId: message.stageId, variableName: message.variableName }, 'Get variable completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get variable';
      logger.error({ error: errorMessage, sessionId: context.connection?.id, conversationId: message.conversationId, stageId: message.stageId, variableName: message.variableName }, 'Failed to get variable');
      const response: CALGetVarResponse = { type: 'get_var', conversationId: message.conversationId, correlationId: message.correlationId, success: false, variableName: message.variableName, error: errorMessage };
      context.send(response);
    }
  }
}

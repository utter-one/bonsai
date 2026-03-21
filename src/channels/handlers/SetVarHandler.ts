import { injectable } from 'tsyringe';
import type { ChannelHandler } from '../ChannelHandler';
import type { ChannelHandlerContext } from '../ChannelHandlerContext';
import type { CALSetVarRequest, CALSetVarResponse } from '../messages';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ChannelHandlerRegistry';

/**
 * Handles set variable requests.
 */
@ChannelMessageHandler('set_var')
@injectable()
export class SetVarHandler implements ChannelHandler<CALSetVarRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles set variable requests.
   */
  async handle(context: ChannelHandlerContext, message: CALSetVarRequest): Promise<void> {
    logger.info({ sessionId: context.connection?.id, conversationId: message.conversationId, stageId: message.stageId, variableName: message.variableName, correlationId: message.correlationId }, 'Set variable request received');

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

      await context.connection.runner.saveCommandEvent('set_var', { stageId: message.stageId, variableName: message.variableName, variableValue: message.variableValue });
      await context.connection.runner.setVariable(message.stageId, message.variableName, message.variableValue);

      const response: CALSetVarResponse = { type: 'set_var_result', conversationId: message.conversationId, correlationId: message.correlationId, success: true };
      context.send(response);

      logger.info({ sessionId: context.connection?.id, conversationId: message.conversationId, stageId: message.stageId, variableName: message.variableName }, 'Set variable completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to set variable';
      logger.error({ error: errorMessage, sessionId: context.connection?.id, conversationId: message.conversationId, stageId: message.stageId, variableName: message.variableName }, 'Failed to set variable');
      const response: CALSetVarResponse = { type: 'set_var_result', conversationId: message.conversationId, correlationId: message.correlationId, success: false, error: errorMessage };
      context.send(response);
    }
  }
}

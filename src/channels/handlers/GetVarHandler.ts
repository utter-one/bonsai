import { injectable } from 'tsyringe';
import type { ChannelHandler, ChannelHandlerContext } from '../ChannelHandler';
import type { GetVarRequest, GetVarResponse } from '../contracts/command';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ChannelHandlerRegistry';

/**
 * Handles get variable requests.
 */
@ChannelMessageHandler('get_var')
@injectable()
export class GetVarHandler implements ChannelHandler<GetVarRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles get variable requests.
   */
  async handle(context: ChannelHandlerContext, message: GetVarRequest): Promise<void> {
    logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, stageId: message.stageId, variableName: message.variableName, requestId: message.requestId }, 'Get variable request received');

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

      const response: GetVarResponse = { type: 'get_var', sessionId: message.sessionId, success: true, variableName: message.variableName, variableValue, requestId: message.requestId };
      context.send(context.ws, response);

      logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, stageId: message.stageId, variableName: message.variableName }, 'Get variable completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get variable';
      logger.error({ error: errorMessage, sessionId: message.sessionId, conversationId: message.conversationId, stageId: message.stageId, variableName: message.variableName }, 'Failed to get variable');
      const response: GetVarResponse = { type: 'get_var', sessionId: message.sessionId, success: false, variableName: message.variableName, error: errorMessage, requestId: message.requestId };
      context.send(context.ws, response);
    }
  }
}

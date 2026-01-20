import { injectable } from 'tsyringe';
import type { MessageHandler, MessageHandlerContext } from './types';
import type { GetVarRequest, GetVarResponse } from '../../contracts/websocket/command';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { MessageHandlerFor } from './registry';

/**
 * Handles get variable requests.
 */
@MessageHandlerFor('get_var')
@injectable()
export class GetVarHandler implements MessageHandler<GetVarRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles get variable requests.
   */
  async handle(context: MessageHandlerContext, message: GetVarRequest): Promise<void> {
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

      const variableValue = await context.connection.runner.getVariable(message.stageId, message.variableName);

      const response: GetVarResponse = { type: 'get_var', sessionId: message.sessionId, success: true, variableName: message.variableName, variableValue, requestId: message.requestId };
      context.send(context.connection.ws, response);

      logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, stageId: message.stageId, variableName: message.variableName }, 'Get variable completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get variable';
      logger.error({ error: errorMessage, sessionId: message.sessionId, conversationId: message.conversationId, stageId: message.stageId, variableName: message.variableName }, 'Failed to get variable');
      const response: GetVarResponse = { type: 'get_var', sessionId: message.sessionId, success: false, variableName: message.variableName, error: errorMessage, requestId: message.requestId };
      context.send(context.connection!.ws, response);
    }
  }
}

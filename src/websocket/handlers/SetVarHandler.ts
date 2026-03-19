import { injectable } from 'tsyringe';
import type { WebSocketHandler, WebSocketHandlerContext } from '../WebSocketHandler';
import type { SetVarRequest, SetVarResponse } from '../contracts/command';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { WebSocketMessageHandler } from '../WebSocketHandlerRegistry';

/**
 * Handles set variable requests.
 */
@WebSocketMessageHandler('set_var')
@injectable()
export class SetVarHandler implements WebSocketHandler<SetVarRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles set variable requests.
   */
  async handle(context: WebSocketHandlerContext, message: SetVarRequest): Promise<void> {
    logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, stageId: message.stageId, variableName: message.variableName, requestId: message.requestId }, 'Set variable request received');

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

      const response: SetVarResponse = { type: 'set_var', sessionId: message.sessionId, success: true, requestId: message.requestId };
      context.send(context.connection.ws, response);

      logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, stageId: message.stageId, variableName: message.variableName }, 'Set variable completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to set variable';
      logger.error({ error: errorMessage, sessionId: message.sessionId, conversationId: message.conversationId, stageId: message.stageId, variableName: message.variableName }, 'Failed to set variable');
      const response: SetVarResponse = { type: 'set_var', sessionId: message.sessionId, success: false, error: errorMessage, requestId: message.requestId };
      context.send(context.connection!.ws, response);
    }
  }
}

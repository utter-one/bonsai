import { injectable } from 'tsyringe';
import type { WebSocketHandler, WebSocketHandlerContext } from '../WebSocketHandler';
import type { GetAllVarsRequest, GetAllVarsResponse } from '../../contracts/websocket/command';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { WebSocketMessageHandler } from '../WebSocketHandlerRegistry';

/**
 * Handles get all variables requests.
 */
@WebSocketMessageHandler('get_all_vars')
@injectable()
export class GetAllVarsHandler implements WebSocketHandler<GetAllVarsRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles get all variables requests.
   */
  async handle(context: WebSocketHandlerContext, message: GetAllVarsRequest): Promise<void> {
    logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, stageId: message.stageId, requestId: message.requestId }, 'Get all variables request received');

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

      const variables = await context.connection.runner.getAllVariables(message.stageId);

      const response: GetAllVarsResponse = { type: 'get_all_vars', sessionId: message.sessionId, success: true, variables, requestId: message.requestId };
      context.send(context.connection.ws, response);

      logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, stageId: message.stageId }, 'Get all variables completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get all variables';
      logger.error({ error: errorMessage, sessionId: message.sessionId, conversationId: message.conversationId, stageId: message.stageId }, 'Failed to get all variables');
      const response: GetAllVarsResponse = { type: 'get_all_vars', sessionId: message.sessionId, success: false, variables: {}, error: errorMessage, requestId: message.requestId };
      context.send(context.connection!.ws, response);
    }
  }
}

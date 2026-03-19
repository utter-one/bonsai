import { injectable } from 'tsyringe';
import type { WebSocketHandler, WebSocketHandlerContext } from '../WebSocketHandler';
import type { RunActionRequest, RunActionResponse } from '../contracts/command';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { WebSocketMessageHandler } from '../WebSocketHandlerRegistry';

/**
 * Handles run action requests.
 */
@WebSocketMessageHandler('run_action')
@injectable()
export class RunActionHandler implements WebSocketHandler<RunActionRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles run action requests.
   */
  async handle(context: WebSocketHandlerContext, message: RunActionRequest): Promise<void> {
    logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, actionName: message.actionName, requestId: message.requestId, message }, 'Run action request received');

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

      const response: RunActionResponse = { type: 'run_action', sessionId: message.sessionId, success: true, result, requestId: message.requestId };
      context.send(context.connection.ws, response);

      logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, actionName: message.actionName }, 'Run action completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to run action';
      logger.error({ error: errorMessage, sessionId: message.sessionId, conversationId: message.conversationId, actionName: message.actionName }, 'Failed to run action');
      const response: RunActionResponse = { type: 'run_action', sessionId: message.sessionId, success: false, error: errorMessage, requestId: message.requestId };
      context.send(context.connection!.ws, response);
    }
  }
}

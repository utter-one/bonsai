import { injectable } from 'tsyringe';
import type { WebSocketHandler, WebSocketHandlerContext } from '../WebSocketHandler';
import type { CallToolRequest, CallToolResponse } from '../contracts/command';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { WebSocketMessageHandler } from '../WebSocketHandlerRegistry';

/**
 * Handles call tool requests.
 */
@WebSocketMessageHandler('call_tool')
@injectable()
export class CallToolHandler implements WebSocketHandler<CallToolRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles call tool requests.
   */
  async handle(context: WebSocketHandlerContext, message: CallToolRequest): Promise<void> {
    logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, toolId: message.toolId, requestId: message.requestId }, 'Call tool request received');

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

      const result = await context.connection.runner.callTool(message.toolId, message.parameters);

      const response: CallToolResponse = { type: 'call_tool', sessionId: message.sessionId, success: true, result, requestId: message.requestId };
      context.send(context.connection.ws, response);

      logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, toolId: message.toolId }, 'Call tool completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to call tool';
      logger.error({ error: errorMessage, sessionId: message.sessionId, conversationId: message.conversationId, toolId: message.toolId }, 'Failed to call tool');
      const response: CallToolResponse = { type: 'call_tool', sessionId: message.sessionId, success: false, error: errorMessage, requestId: message.requestId };
      context.send(context.connection!.ws, response);
    }
  }
}

import { injectable } from 'tsyringe';
import type { ChannelHandler } from '../ChannelHandler';
import type { ChannelHandlerContext } from '../ChannelHandlerContext';
import type { CALCallToolRequest, CALCallToolResponse } from '../messages';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ChannelHandlerRegistry'

/**
 * Handles call tool requests.
 */
@ChannelMessageHandler('call_tool')
@injectable()
export class CallToolHandler implements ChannelHandler<CALCallToolRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles call tool requests.
   */
  async handle(context: ChannelHandlerContext, message: CALCallToolRequest): Promise<void> {
    logger.info({ sessionId: context.connection?.id, conversationId: message.conversationId, toolId: message.toolId, correlationId: message.correlationId }, 'Call tool request received');

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

      await context.connection.runner.saveCommandEvent('call_tool', { toolId: message.toolId, parameters: message.parameters });
      const result = await context.connection.runner.callTool(message.toolId, message.parameters);

      const response: CALCallToolResponse = { 
        type: 'call_tool', 
        success: true, 
        result, 
        conversationId: message.conversationId, 
        correlationId: message.correlationId 
      };
      context.send(response);

      logger.info({ sessionId: context.connection?.id, conversationId: message.conversationId, toolId: message.toolId, correlationId: message.correlationId }, 'Call tool completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to call tool';
      logger.error({ error: errorMessage, sessionId: context.connection?.id, conversationId: message.conversationId, toolId: message.toolId, correlationId: message.correlationId }, 'Failed to call tool');
      const response: CALCallToolResponse = { 
        type: 'call_tool', 
        success: false, 
        error: errorMessage, 
        conversationId: message.conversationId, 
        correlationId: message.correlationId 
      };
      context.send(response);
    }
  }
}

import { injectable } from 'tsyringe';
import type { ClientMessageHandler } from '../ClientMessageHandler';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import { calCallToolRequestSchema } from '../messages';
import type { CALCallToolRequest, CALCallToolResponse } from '../messages';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ClientMessageHandlerRegistry'

/**
 * Handles call tool requests.
 */
@ChannelMessageHandler('call_tool', true, calCallToolRequestSchema, 'call_tool')
@injectable()
export class CallToolHandler implements ClientMessageHandler<CALCallToolRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles call tool requests.
   */
  async handle(context: ClientMessageHandlerContext, message: CALCallToolRequest): Promise<void> {
    logger.info({ sessionId: context.session?.id, conversationId: message.conversationId, toolId: message.toolId, correlationId: message.correlationId }, 'Call tool request received');

    try {
      if (!context.session) {
        throw new NotFoundError('Session not found');
      }

      if (!context.session.conversationId) {
        throw new InvalidOperationError('No active conversation in this session');
      }

      if (context.session.conversationId !== message.conversationId) {
        throw new InvalidOperationError('Conversation ID mismatch');
      }

      await context.session.runner.saveCommandEvent('call_tool', { toolId: message.toolId, parameters: message.parameters });
      const result = await context.session.runner.callTool(message.toolId, message.parameters);

      const response: CALCallToolResponse = { 
        type: 'call_tool', 
        success: true, 
        result, 
        conversationId: message.conversationId, 
        correlationId: message.correlationId 
      };
      context.send(response);

      logger.info({ sessionId: context.session?.id, conversationId: message.conversationId, toolId: message.toolId, correlationId: message.correlationId }, 'Call tool completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to call tool';
      logger.error({ error: errorMessage, sessionId: context.session?.id, conversationId: message.conversationId, toolId: message.toolId, correlationId: message.correlationId }, 'Failed to call tool');
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

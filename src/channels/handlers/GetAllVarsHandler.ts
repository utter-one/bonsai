import { injectable } from 'tsyringe';
import type { ClientMessageHandler } from '../ClientMessageHandler';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import { calGetAllVarsRequestSchema } from '../messages';
import type { CALGetAllVarsRequest, CALGetAllVarsResponse } from '../messages';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ClientMessageHandlerRegistry';

/**
 * Handles get all variables requests.
 */
@ChannelMessageHandler('get_all_vars', true, calGetAllVarsRequestSchema, 'vars_access')
@injectable()
export class GetAllVarsHandler implements ClientMessageHandler<CALGetAllVarsRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles get all variables requests.
   */
  async handle(context: ClientMessageHandlerContext, message: CALGetAllVarsRequest): Promise<void> {
    logger.info({ sessionId: context.session?.id, conversationId: message.conversationId, stageId: message.stageId, correlationId: message.correlationId }, 'Get all variables request received');

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

      await context.session.runner.saveCommandEvent('get_all_vars', { stageId: message.stageId });
      const variables = await context.session.runner.getAllVariables(message.stageId);

      const response: CALGetAllVarsResponse = { type: 'get_all_vars', conversationId: message.conversationId, correlationId: message.correlationId, success: true, variables };
      context.send(response);

      logger.info({ sessionId: context.session?.id, conversationId: message.conversationId, stageId: message.stageId }, 'Get all variables completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get all variables';
      logger.error({ error: errorMessage, sessionId: context.session?.id, conversationId: message.conversationId, stageId: message.stageId }, 'Failed to get all variables');
      const response: CALGetAllVarsResponse = { type: 'get_all_vars', conversationId: message.conversationId, correlationId: message.correlationId, success: false, variables: {}, error: errorMessage };
      context.send(response);
    }
  }
}

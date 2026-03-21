import { injectable } from 'tsyringe';
import type { ChannelHandler } from '../ChannelHandler';
import type { ChannelHandlerContext } from '../ChannelHandlerContext';
import type { CALStartUserVoiceInputRequest, CALStartUserVoiceInputResponse } from '../messages';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ChannelHandlerRegistry';

/**
 * Handles start user voice input requests.
 */
@ChannelMessageHandler('start_user_voice_input')
@injectable()
export class StartUserVoiceInputHandler implements ChannelHandler<CALStartUserVoiceInputRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles start user voice input requests.
   */
  async handle(context: ChannelHandlerContext, message: CALStartUserVoiceInputRequest): Promise<void> {
    logger.info({ sessionId: context.connection?.id, conversationId: message.conversationId, correlationId: message.correlationId }, 'Start user voice input request received');

    try {
      if (!context.connection) {
        throw new NotFoundError('Session not found');
      }

      if (!context.connection.sessionSettings.sendVoiceInput) {
        throw new InvalidOperationError('Voice input is disabled for this session');
      }

      if (!context.connection.conversationId) {
        throw new InvalidOperationError('No active conversation in this session');
      }

      if (context.connection.conversationId !== message.conversationId) {
        throw new InvalidOperationError('Conversation ID mismatch');
      }

      const inputTurnId = await context.connection.runner.startUserVoiceInput();

      const response: CALStartUserVoiceInputResponse = {
        type: 'start_user_voice_input',
        conversationId: message.conversationId,
        correlationId: message.correlationId,
        success: true,
        inputTurnId
      };
      context.send(response);

      logger.info({ sessionId: context.connection?.id, conversationId: message.conversationId }, 'User voice input started successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start user voice input';
      logger.error({ error: errorMessage, sessionId: context.connection?.id, conversationId: message.conversationId }, 'Failed to start user voice input');
      const response: CALStartUserVoiceInputResponse = {
        type: 'start_user_voice_input',
        conversationId: message.conversationId,
        correlationId: message.correlationId,
        success: false,
        error: errorMessage
      };
      context.send(response);
    }
  }
}

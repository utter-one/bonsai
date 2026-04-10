import { injectable } from 'tsyringe';
import type { ClientMessageHandler } from '../ClientMessageHandler';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import { calStartUserVoiceInputRequestSchema } from '../messages';
import type { CALStartUserVoiceInputRequest, CALStartUserVoiceInputResponse } from '../messages';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ClientMessageHandlerRegistry';

/**
 * Handles start user voice input requests.
 */
@ChannelMessageHandler('start_user_voice_input', true, calStartUserVoiceInputRequestSchema, 'voice_input')
@injectable()
export class StartUserVoiceInputHandler implements ClientMessageHandler<CALStartUserVoiceInputRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles start user voice input requests.
   */
  async handle(context: ClientMessageHandlerContext, message: CALStartUserVoiceInputRequest): Promise<void> {
    logger.info({ sessionId: context.session?.id, conversationId: message.conversationId, correlationId: message.correlationId }, 'Start user voice input request received');

    try {
      if (!context.session) {
        throw new NotFoundError('Session not found');
      }

      if (!context.session.sessionSettings.sendVoiceInput) {
        throw new InvalidOperationError('Voice input is disabled for this session');
      }

      if (!context.session.conversationId) {
        throw new InvalidOperationError('No active conversation in this session');
      }

      if (context.session.conversationId !== message.conversationId) {
        throw new InvalidOperationError('Conversation ID mismatch');
      }

      const inputTurnId = await context.session.runner.startUserVoiceInput();

      const response: CALStartUserVoiceInputResponse = {
        type: 'start_user_voice_input',
        conversationId: message.conversationId,
        correlationId: message.correlationId,
        success: true,
        inputTurnId
      };
      context.send(response);

      logger.info({ sessionId: context.session?.id, conversationId: message.conversationId }, 'User voice input started successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start user voice input';
      logger.error({ error: errorMessage, sessionId: context.session?.id, conversationId: message.conversationId }, 'Failed to start user voice input');
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

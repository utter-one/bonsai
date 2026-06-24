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

      if (!context.session.runner) {
        throw new InvalidOperationError('No active conversation runner');
      }

      const inputTurnId = await context.session.runner.startUserVoiceInput();

      const response: CALStartUserVoiceInputResponse = {
        type: 'start_user_voice_input',
        conversationId: message.conversationId,
        correlationId: message.correlationId,
        success: true,
        inputTurnId
      };
      try {
        context.send(response);
      } catch (sendError) {
        logger.error({ error: sendError instanceof Error ? sendError.message : String(sendError), sessionId: context.session?.id, conversationId: message.conversationId }, 'Failed to send start user voice input response');
        throw sendError;
      }

      logger.info({ sessionId: context.session?.id, conversationId: message.conversationId }, 'User voice input started successfully');
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof InvalidOperationError) {
        const errorMessage = error.message;
        logger.error({ error: errorMessage, sessionId: context.session?.id, conversationId: message.conversationId }, 'Failed to start user voice input');
        const response: CALStartUserVoiceInputResponse = {
          type: 'start_user_voice_input',
          conversationId: message.conversationId,
          correlationId: message.correlationId,
          success: false,
          error: errorMessage
        };
        context.send(response);
      } else {
        logger.error({ error: error instanceof Error ? error.message : String(error), sessionId: context.session?.id, conversationId: message.conversationId }, 'Unexpected error starting user voice input');
        throw error;
      }
    }
  }
}

import { injectable } from 'tsyringe';
import type { ClientMessageHandler } from '../ClientMessageHandler';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import { calEndUserVoiceInputRequestSchema } from '../messages';
import type { CALEndUserVoiceInputRequest, CALEndUserVoiceInputResponse } from '../messages';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ClientMessageHandlerRegistry';

/**
 * Handles end user voice input requests.
 */
@ChannelMessageHandler('end_user_voice_input', true, calEndUserVoiceInputRequestSchema)
@injectable()
export class EndUserVoiceInputHandler implements ClientMessageHandler<CALEndUserVoiceInputRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles end user voice input requests.
   */
  async handle(context: ClientMessageHandlerContext, message: CALEndUserVoiceInputRequest): Promise<void> {
    logger.info({ sessionId: context.session?.id, conversationId: message.conversationId, correlationId: message.correlationId }, 'End user voice input request received');

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

      await context.session.runner.stopUserVoiceInput(message.inputTurnId);

      const response: CALEndUserVoiceInputResponse = { 
        type: 'end_user_voice_input', 
        conversationId: message.conversationId,
        correlationId: message.correlationId,
        success: true, 
        inputTurnId: message.inputTurnId
      };
      context.send(response);

      logger.info({ sessionId: context.session?.id, conversationId: message.conversationId }, 'User voice input ended successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to end user voice input';
      logger.error({ error: errorMessage, sessionId: context.session?.id, conversationId: message.conversationId }, 'Failed to end user voice input');
      const response: CALEndUserVoiceInputResponse = { 
        type: 'end_user_voice_input', 
        conversationId: message.conversationId,
        correlationId: message.correlationId,
        success: false, 
        error: errorMessage, 
        inputTurnId: message.inputTurnId
      };
      context.send(response);
    }
  }
}

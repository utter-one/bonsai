import { injectable } from 'tsyringe';
import type { ClientMessageHandler } from '../ClientMessageHandler';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import { calSendUserTextInputRequestSchema } from '../messages';
import type { CALSendUserTextInputRequest, CALSendUserTextInputResponse } from '../messages';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ClientMessageHandlerRegistry';

/**
 * Handles send user text input requests.
 */
@ChannelMessageHandler('send_user_text_input', true, calSendUserTextInputRequestSchema)
@injectable()
export class SendUserTextInputHandler implements ClientMessageHandler<CALSendUserTextInputRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles send user text input requests.
   */
  async handle(context: ClientMessageHandlerContext, message: CALSendUserTextInputRequest): Promise<void> {
    logger.info({ sessionId: context.session?.id, conversationId: message.conversationId, correlationId: message.correlationId }, 'Send user text input request received');

    let inputTurnId = '';
    try {
      if (!context.session) {
        throw new NotFoundError('Session not found');
      }

      if (!context.session.sessionSettings.sendTextInput) {
        throw new InvalidOperationError('Text input is disabled for this session');
      }

      if (!context.session.conversationId) {
        throw new InvalidOperationError('No active conversation in this session');
      }

      if (context.session.conversationId !== message.conversationId) {
        throw new InvalidOperationError('Conversation ID mismatch');
      }

      inputTurnId = await context.session.runner.receiveUserTextInput(message.text);

      const response: CALSendUserTextInputResponse = { 
        type: 'send_user_text_input', 
        conversationId: message.conversationId,
        correlationId: message.correlationId,
        success: true, 
        inputTurnId
      };
      context.send(response);

      logger.info({ sessionId: context.session?.id, conversationId: message.conversationId }, 'User text input received successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to process text input';
      logger.error({ error: errorMessage, sessionId: context.session?.id, conversationId: message.conversationId }, 'Failed to process text input');
      const response: CALSendUserTextInputResponse = { 
        type: 'send_user_text_input', 
        conversationId: message.conversationId,
        correlationId: message.correlationId,
        success: false, 
        error: errorMessage, 
        inputTurnId
      };
      context.send(response);
    }
  }
}

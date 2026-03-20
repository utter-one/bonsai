import { injectable } from 'tsyringe';
import type { ChannelHandler, ChannelHandlerContext } from '../ChannelHandler';
import type { SendUserTextInputRequest, SendUserTextInputResponse } from '../contracts/userInput';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ChannelHandlerRegistry';

/**
 * Handles send user text input requests.
 */
@ChannelMessageHandler('send_user_text_input')
@injectable()
export class SendUserTextInputHandler implements ChannelHandler<SendUserTextInputRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles send user text input requests.
   */
  async handle(context: ChannelHandlerContext, message: SendUserTextInputRequest): Promise<void> {
    logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, requestId: message.requestId }, 'Send user text input request received');

    let inputTurnId = '';
    try {
      if (!context.connection) {
        throw new NotFoundError('Session not found');
      }

      if (!context.connection.sessionSettings.sendTextInput) {
        throw new InvalidOperationError('Text input is disabled for this session');
      }

      if (!context.connection.conversationId) {
        throw new InvalidOperationError('No active conversation in this session');
      }

      if (context.connection.conversationId !== message.conversationId) {
        throw new InvalidOperationError('Conversation ID mismatch');
      }

      inputTurnId = await context.connection.runner.receiveUserTextInput(message.text);

      const response: SendUserTextInputResponse = { 
        type: 'send_user_text_input', 
        sessionId: message.sessionId, 
        success: true, 
        requestId: message.requestId,
        inputTurnId: inputTurnId
      };
      context.send(context.ws, response);

      logger.info({ sessionId: message.sessionId, conversationId: message.conversationId }, 'User text input received successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to process text input';
      logger.error({ error: errorMessage, sessionId: message.sessionId, conversationId: message.conversationId }, 'Failed to process text input');
      const response: SendUserTextInputResponse = { 
        type: 'send_user_text_input', 
        sessionId: message.sessionId, 
        success: false, 
        error: errorMessage, 
        requestId: message.requestId,
        inputTurnId
      };
      context.send(context.ws, response);
    }
  }
}

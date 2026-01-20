import { injectable } from 'tsyringe';
import type { WebSocketHandler, WebSocketHandlerContext } from '../WebSocketHandler';
import type { SendUserTextInputRequest, SendUserTextInputResponse } from '../../contracts/websocket/userInput';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { WebSocketMessageHandler } from '../WebSocketHandlerRegistry';

/**
 * Handles send user text input requests.
 */
@WebSocketMessageHandler('send_user_text_input')
@injectable()
export class SendUserTextInputHandler implements WebSocketHandler<SendUserTextInputRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles send user text input requests.
   */
  async handle(context: WebSocketHandlerContext, message: SendUserTextInputRequest): Promise<void> {
    logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, requestId: message.requestId }, 'Send user text input request received');

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

      await context.connection.runner.receiveUserTextInput(message.text);

      const response: SendUserTextInputResponse = { type: 'send_user_text_input', sessionId: message.sessionId, success: true, requestId: message.requestId };
      context.send(context.connection.ws, response);

      logger.info({ sessionId: message.sessionId, conversationId: message.conversationId }, 'User text input received successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to process text input';
      logger.error({ error: errorMessage, sessionId: message.sessionId, conversationId: message.conversationId }, 'Failed to process text input');
      const response: SendUserTextInputResponse = { type: 'send_user_text_input', sessionId: message.sessionId, success: false, error: errorMessage, requestId: message.requestId };
      context.send(context.connection!.ws, response);
    }
  }
}

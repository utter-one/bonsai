import { injectable } from 'tsyringe';
import type { WebSocketHandler, WebSocketHandlerContext } from '../WebSocketHandler';
import type { EndUserVoiceInputRequest, EndUserVoiceInputResponse } from '../contracts/userInput';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { WebSocketMessageHandler } from '../WebSocketHandlerRegistry';

/**
 * Handles end user voice input requests.
 */
@WebSocketMessageHandler('end_user_voice_input')
@injectable()
export class EndUserVoiceInputHandler implements WebSocketHandler<EndUserVoiceInputRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles end user voice input requests.
   */
  async handle(context: WebSocketHandlerContext, message: EndUserVoiceInputRequest): Promise<void> {
    logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, requestId: message.requestId }, 'End user voice input request received');

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

      await context.connection.runner.stopUserVoiceInput(message.inputTurnId);

      const response: EndUserVoiceInputResponse = { 
        type: 'end_user_voice_input', 
        sessionId: message.sessionId, 
        success: true, 
        requestId: message.requestId,
        inputTurnId: message.inputTurnId
      };
      context.send(context.connection.ws, response);

      logger.info({ sessionId: message.sessionId, conversationId: message.conversationId }, 'User voice input ended successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to end user voice input';
      logger.error({ error: errorMessage, sessionId: message.sessionId, conversationId: message.conversationId }, 'Failed to end user voice input');
      const response: EndUserVoiceInputResponse = { 
        type: 'end_user_voice_input', 
        sessionId: message.sessionId, 
        success: false, 
        error: errorMessage, 
        requestId: message.requestId,
        inputTurnId: message.inputTurnId
      };
      context.send(context.connection!.ws, response);
    }
  }
}

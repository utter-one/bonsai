import { injectable } from 'tsyringe';
import type { WebSocketHandler, WebSocketHandlerContext } from '../WebSocketHandler';
import type { SendUserVoiceChunkRequest, SendUserVoiceChunkResponse } from '../contracts/userInput';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { WebSocketMessageHandler } from '../WebSocketHandlerRegistry';

/**
 * Handles send user voice chunk requests.
 */
@WebSocketMessageHandler('send_user_voice_chunk')
@injectable()
export class SendUserVoiceChunkHandler implements WebSocketHandler<SendUserVoiceChunkRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles send user voice chunk requests.
   */
  async handle(context: WebSocketHandlerContext, message: SendUserVoiceChunkRequest): Promise<void> {
    logger.debug({ sessionId: message.sessionId, conversationId: message.conversationId, requestId: message.requestId }, 'Send user voice chunk request received');

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

      const audioBuffer = Buffer.from(message.audioData, 'base64');
      await context.connection.runner.receiveUserVoiceData(message.inputTurnId, audioBuffer);

      const response: SendUserVoiceChunkResponse = { 
        type: 'send_user_voice_chunk', 
        sessionId: message.sessionId, 
        success: true, 
        requestId: message.requestId,
        inputTurnId: message.inputTurnId
      };
      context.send(context.connection.ws, response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to process voice chunk';
      logger.error({ error: errorMessage, sessionId: message.sessionId, conversationId: message.conversationId }, 'Failed to process voice chunk');
      const response: SendUserVoiceChunkResponse = { 
        type: 'send_user_voice_chunk', 
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

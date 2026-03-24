import { injectable } from 'tsyringe';
import type { ClientMessageHandler } from '../ClientMessageHandler';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import { sendUserVoiceChunkRequestSchema } from '../websocket/contracts/userInput';
import type { SendUserVoiceChunkRequest, SendUserVoiceChunkResponse } from '../websocket/contracts/userInput';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ClientMessageHandlerRegistry';

/**
 * Handles send user voice chunk requests.
 */
@ChannelMessageHandler('send_user_voice_chunk', true, sendUserVoiceChunkRequestSchema)
@injectable()
export class SendUserVoiceChunkHandler implements ClientMessageHandler<SendUserVoiceChunkRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles send user voice chunk requests.
   */
  async handle(context: ClientMessageHandlerContext, message: SendUserVoiceChunkRequest): Promise<void> {
    logger.debug({ sessionId: message.sessionId, conversationId: message.conversationId, requestId: message.requestId }, 'Send user voice chunk request received');

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

      const audioBuffer = Buffer.from(message.audioData, 'base64');
      await context.session.runner.receiveUserVoiceData(message.inputTurnId, audioBuffer);

      const response: SendUserVoiceChunkResponse = { 
        type: 'send_user_voice_chunk', 
        sessionId: message.sessionId, 
        success: true, 
        requestId: message.requestId,
        inputTurnId: message.inputTurnId
      };
      context.send(response);
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
      context.send(response);
    }
  }
}

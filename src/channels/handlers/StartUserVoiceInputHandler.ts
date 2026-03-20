import { injectable } from 'tsyringe';
import type { ChannelHandler, ChannelHandlerContext } from '../ChannelHandler';
import type { StartUserVoiceInputRequest, StartUserVoiceInputResponse } from '../contracts/userInput';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ChannelHandlerRegistry';

/**
 * Handles start user voice input requests.
 */
@ChannelMessageHandler('start_user_voice_input')
@injectable()
export class StartUserVoiceInputHandler implements ChannelHandler<StartUserVoiceInputRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles start user voice input requests.
   */
  async handle(context: ChannelHandlerContext, message: StartUserVoiceInputRequest): Promise<void> {
    logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, requestId: message.requestId }, 'Start user voice input request received');

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

      const response: StartUserVoiceInputResponse = {
        type: 'start_user_voice_input',
        sessionId: message.sessionId,
        success: true,
        requestId: message.requestId,
        inputTurnId
      };
      context.send(context.ws, response);

      logger.info({ sessionId: message.sessionId, conversationId: message.conversationId }, 'User voice input started successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start user voice input';
      logger.error({ error: errorMessage, sessionId: message.sessionId, conversationId: message.conversationId }, 'Failed to start user voice input');
      const response: StartUserVoiceInputResponse = {
        type: 'start_user_voice_input',
        sessionId: message.sessionId,
        success: false,
        error: errorMessage,
        requestId: message.requestId,
        inputTurnId: '' // Return empty inputTurnId on failure
      };
      context.send(context.ws, response);
    }
  }
}

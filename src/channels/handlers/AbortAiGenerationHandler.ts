import { injectable } from 'tsyringe';
import type { ClientMessageHandler } from '../ClientMessageHandler';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import { calAbortAiGenerationRequestSchema } from '../messages';
import type { CALAbortAiGenerationRequest, CALAbortAiGenerationResponse } from '../messages';
import { NotFoundError, InvalidOperationError } from '../../errors';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ClientMessageHandlerRegistry';

/**
 * Handles abort AI generation requests (barge-in interrupt).
 * Stops the current AI response and prepares for user input.
 */
@ChannelMessageHandler('abort_ai_generation', true, calAbortAiGenerationRequestSchema, 'abort_generation')
@injectable()
export class AbortAiGenerationHandler implements ClientMessageHandler<CALAbortAiGenerationRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  /**
   * Handles abort AI generation requests.
   */
  async handle(context: ClientMessageHandlerContext, message: CALAbortAiGenerationRequest): Promise<void> {
    logger.info({ sessionId: context.session?.id, conversationId: message.conversationId, correlationId: message.correlationId }, 'Abort AI generation request received');

    try {
      if (!context.session) {
        throw new NotFoundError('Session not found');
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

      await context.session.runner.abortCurrentResponse();

      const response: CALAbortAiGenerationResponse = { type: 'abort_ai_generation', conversationId: message.conversationId, correlationId: message.correlationId, success: true };
      context.send(response);

      logger.info({ sessionId: context.session?.id, conversationId: message.conversationId }, 'AI generation aborted successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to abort AI generation';
      logger.error({ error: errorMessage, sessionId: context.session?.id, conversationId: message.conversationId }, 'Failed to abort AI generation');
      const response: CALAbortAiGenerationResponse = { type: 'abort_ai_generation', conversationId: message.conversationId, correlationId: message.correlationId, success: false, error: errorMessage };
      context.send(response);
    }
  }
}

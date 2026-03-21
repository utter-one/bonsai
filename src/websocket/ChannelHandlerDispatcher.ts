import 'reflect-metadata';
import { singleton } from 'tsyringe';
import { logger } from '../utils/logger';
import type { CALInputMessage } from '../channels/messages';
import { ChannelHandlerRegistry } from '../channels/ChannelHandlerRegistry';
import type { ChannelHandler } from '../channels/ChannelHandler';
import type { ChannelHandlerContext } from '../channels/ChannelHandlerContext';

// Import handlers module to trigger decorator registration
import '../channels/handlers';

/**
 * Responsible for registering channel message handlers and dispatching
 * incoming messages to the appropriate handler.
 * Channel-agnostic: transport concerns (WebSocket, HTTP, etc.) are handled by the caller.
 */
@singleton()
export class ChannelHandlerDispatcher {
  private handlers = new Map<string, { instance: ChannelHandler; requiresAuth: boolean }>();

  constructor() {
    this.registerHandlers();
  }

  /**
   * Registers all message handlers from the registry.
   * Handlers are automatically discovered via the @ChannelMessageHandler decorator.
   */
  private registerHandlers(): void {
    const registryItems = ChannelHandlerRegistry.getAll();

    for (const messageType of registryItems.keys()) {
      const registryItem = registryItems.get(messageType);
      const handler = registryItem.handlerFactory();
      if (handler) {
        this.handlers.set(messageType, { instance: handler, requiresAuth: registryItem.requiresAuth });
        logger.debug({ messageType: messageType, requiresAuth: registryItem.requiresAuth }, 'Registered message handler');
      }
    }

    logger.info({ count: this.handlers.size }, 'All message handlers registered');
  }

  /**
   * Dispatches a parsed CAL message to the appropriate handler.
   * Routes messages based on the message type and enforces authentication requirements.
   * Transport-specific concerns (parsing, sending) must be handled by the caller via the context.
   * @param message - The already-translated CAL input message.
   * @param context - The handler context supplied by the transport layer.
   */
  async dispatch(message: CALInputMessage, context: ChannelHandlerContext): Promise<void> {
    try {
      logger.debug({ messageType: message.type, correlationId: message.correlationId }, 'Dispatching message');

      const handler = this.handlers.get(message.type);
      if (!handler) {
        logger.warn({ messageType: message.type }, 'Unknown message type received');
        context.sendError('Unknown message type', message.correlationId);
        return;
      }

      // Check if handler requires authentication
      if (handler.requiresAuth && (!context.connection || !context.connection.id)) {
        context.sendError('Authentication required', message.correlationId);
        return;
      }

      await handler.instance.handle(context, message as any);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to dispatch message');
      context.sendError(errorMessage);
    }
  }
}

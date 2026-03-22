import { ClientMessageHandlerContext } from './ClientMessageHandlerContext';

/**
 * Base interface for channel message handlers.
 * Each handler is responsible for processing a specific type of WebSocket message.
 */

export type ClientMessageHandler<T extends Record<string, any> = Record<string, any>> = {
  /**
   * Handles the incoming message.
   * @param context - The handler context containing connection metadata and utilities.
   * @param message - The parsed message to handle.
   */
  handle(context: ClientMessageHandlerContext, message: T): Promise<void> | void;
};

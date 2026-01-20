import { container } from 'tsyringe';
import logger from '../../utils/logger';
import type { MessageHandler } from './types';

/**
 * Global registry for message handlers.
 * Handlers are automatically registered via the @MessageHandlerFor decorator.
 */
export class MessageHandlerRegistry {
  private static handlers: Map<string, () => MessageHandler> = new Map();

  /**
   * Registers a handler class for a specific message type.
   * @param messageType - The message type this handler processes.
   * @param handlerFactory - The handler class factory function.
   */
  static register(messageType: string, handlerFactory: () => MessageHandler): void {
    if (this.handlers.has(messageType)) {
      throw new Error(`Handler for message type "${messageType}" is already registered`);
    }
    this.handlers.set(messageType, handlerFactory);
  }

  /**
   * Gets all registered handler classes.
   * @returns Array of handler class constructors.
   */
  static getAll() {
    return this.handlers;
  }

  /**
   * Clears all registered handlers.
   * Used primarily for testing.
   */
  static clear(): void {
    this.handlers.clear();
  }
}

/**
 * Decorator for automatically registering message handlers.
 * Apply this decorator to handler classes to register them for a specific message type.
 * 
 * @param messageType - The message type this handler processes.
 * @param requiresAuth - Whether this handler requires authentication (default: true).
 * 
 * @example
 * ```typescript
 * @MessageHandlerFor('auth', false)
 * @injectable()
 * export class AuthHandler implements MessageHandler<AuthRequest> {
 *   readonly messageType = 'auth';
 *   readonly requiresAuth = false;
 *   // ...
 * }
 * ```
 */
export function MessageHandlerFor(messageType: string, requiresAuth: boolean = true) {
  return function <T extends new (...args: any[]) => MessageHandler>(constructor: T): T {
    logger.info({ messageType, requiresAuth }, `Registering message handler for type "${messageType}"`);
    // Register the handler class
    MessageHandlerRegistry.register(messageType, () => container.resolve(constructor));

    return constructor;  
  };
}

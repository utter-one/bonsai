import { container } from 'tsyringe';
import logger from '../utils/logger';
import type { ClientMessageHandler } from './ClientMessageHandler';
import type { ZodTypeAny } from 'zod';
import type { ApiKeyFeature } from '../apiKeyFeatures';

type RegistryItem = {
  handlerFactory: () => ClientMessageHandler;
  requiresAuth: boolean;
  schema: ZodTypeAny;
  requiredFeature?: ApiKeyFeature;
}

/**
 * Global registry for client message handlers.
 * Handlers are automatically registered via the @ClientMessageHandler decorator.
 */
export class ClientMessageHandlerRegistry {
  private static handlers: Map<string, RegistryItem> = new Map();
  /**
   * Registers a handler class for a specific message type.
   * @param messageType - The message type this handler processes.
   * @param handlerFactory - The handler class factory function.
   */
  static register(messageType: string, handlerFactory: () => ClientMessageHandler, requiresAuth: boolean, schema: ZodTypeAny, requiredFeature?: ApiKeyFeature): void {
    if (this.handlers.has(messageType)) {
      throw new Error(`Handler for message type "${messageType}" is already registered`);
    }
    this.handlers.set(messageType, { handlerFactory, requiresAuth, schema, requiredFeature });
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
export function ChannelMessageHandler(messageType: string, requiresAuth: boolean, schema: ZodTypeAny, requiredFeature?: ApiKeyFeature) {
  return function <T extends new (...args: any[]) => ClientMessageHandler>(constructor: T): T {
    logger.debug({ messageType, requiresAuth, requiredFeature }, `Registering message handler for type "${messageType}"`);
    ClientMessageHandlerRegistry.register(messageType, () => container.resolve(constructor), requiresAuth, schema, requiredFeature);
    return constructor;
  };
}

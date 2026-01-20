import { inject, singleton, container } from 'tsyringe';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { ConnectionManager } from './ConnectionManager';
import { logger } from '../utils/logger';
import type { BaseInputMessage, BaseOutputMessage } from '../contracts/websocket/common';
import { MessageHandlerContext, MessageHandlerRegistry } from './handlers';
// Import handlers module to trigger decorator registration
import './handlers';

/**
 * WebSocket server that manages client connections and message routing.
 * Handles authentication, session management, and conversation lifecycle.
 */
@singleton()
export class ConversationServer {
  private wss: WebSocketServer | null = null;
  private handlers = new Map<string, any>();

  constructor(@inject(ConnectionManager) private connectionManager: ConnectionManager) {
    this.registerHandlers();
  }

  /**
   * Registers all message handlers from the registry.
   * Handlers are automatically discovered via the @MessageHandlerFor decorator.
   */
  private registerHandlers(): void {
    const handlerClasses = MessageHandlerRegistry.getAll();

    for (const messageType of handlerClasses.keys()) {
      const handler = handlerClasses.get(messageType)();
      if (handler) {
        this.handlers.set(messageType, handler);
        logger.debug({ messageType: messageType, requiresAuth: messageType !== 'auth' }, 'Registered message handler');
      }
    }

    logger.info({ count: this.handlers.size }, 'All message handlers registered');
  }

  /**
   * Initializes the WebSocket server and attaches it to an HTTP server.
   * @param server - The HTTP server to attach the WebSocket server to.
   */
  initialize(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      logger.info('New WebSocket connection established');

      ws.on('message', (data: Buffer) => {
        this.handleMessage(ws, data);
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });

      ws.on('error', (error: Error) => {
        logger.error({ error: error.message }, 'WebSocket error occurred');
      });
    });

    logger.info('WebSocket server initialized on path /ws');
  }

  /**
   * Handles incoming WebSocket messages.
   * Routes messages to appropriate handlers based on message type.
   * @param ws - The WebSocket connection that sent the message.
   * @param data - The raw message data.
   */
  private async handleMessage(ws: WebSocket, data: Buffer): Promise<void> {
    try {
      const message = JSON.parse(data.toString()) as BaseInputMessage;

      logger.debug({ messageType: message.type, requestId: message.requestId }, 'Received WebSocket message');

      const handler = this.handlers.get(message.type);
      if (!handler) {
        logger.warn({ messageType: message.type }, 'Unknown message type received');
        this.sendError(ws, 'Unknown message type', message.requestId);
        return;
      }

      const connection = this.connectionManager.getConnectionForWebSocket(ws);
      
      // Check if handler requires authentication
      if (handler.requiresAuth && (!connection || !connection.id)) {
        this.sendError(ws, 'Authentication required', message.requestId);
        return;
      }

      const context: MessageHandlerContext = { ws, connection, send: this.send.bind(this), sendError: this.sendError.bind(this) };

      await handler.handle(context, message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Failed to handle WebSocket message');
      this.sendError(ws, message);
    }
  }

  /**
   * Handles WebSocket disconnection.
   * Cleans up session and removes authentication status.
   * @param ws - The WebSocket connection that was disconnected.
   */
  private handleDisconnect(ws: WebSocket): void {
    // Find and end the session associated with this WebSocket
    // Note: We need to iterate through the session manager's internal state
    // This is a limitation of the current SessionManager API
    logger.info('WebSocket connection closed');
  }

  /**
   * Sends a message to a WebSocket client.
   * @param ws - The WebSocket connection to send the message to.
   * @param message - The message to send.
   */
  private send(ws: WebSocket, message: BaseOutputMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Sends an error message to a WebSocket client.
   * @param ws - The WebSocket connection to send the error to.
   * @param error - The error message.
   * @param requestId - Optional request ID for correlation.
   */
  private sendError(ws: WebSocket, error: string, requestId?: string): void {
    const message = { type: 'error', error, requestId };
    ws.send(JSON.stringify(message));
  }

  /**
   * Closes the WebSocket server and all active connections.
   */
  close(): void {
    if (this.wss) {
      this.wss.close(() => {
        logger.info('WebSocket server closed');
      });
    }
  }
}

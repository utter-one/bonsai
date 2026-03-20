import 'reflect-metadata';
import { inject, singleton } from 'tsyringe';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { IncomingMessage } from 'http';
import { ConnectionManager } from './ConnectionManager';
import { ChannelHandlerDispatcher } from './ChannelHandlerDispatcher';
import { logger } from '../utils/logger';
import type { BaseInputMessage, BaseOutputMessage } from './contracts/common';
import type { CALInputMessage } from '../channels/messages';
import type { ChannelHandlerContext } from '../channels/channel';

/**
 * WebSocket server that manages client connections and message routing.
 * Handles authentication, session management, and conversation lifecycle.
 */
@singleton()
export class WebSocketChannelHost {
  private wss: WebSocketServer | null = null;

  constructor(
    @inject(ConnectionManager) private readonly connectionManager: ConnectionManager,
    @inject(ChannelHandlerDispatcher) private readonly dispatcher: ChannelHandlerDispatcher,
  ) {}

  /**
   * Initializes the WebSocket server and attaches it to an HTTP server.
   * @param server - The HTTP server to attach the WebSocket server to.
   */
  initialize(server: Server): void {
    const maxPayload = parseInt(process.env.WS_MAX_PAYLOAD_BYTES ?? String(10 * 1024 * 1024), 10);
    this.wss = new WebSocketServer({ server, path: '/ws', maxPayload });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      // Prefer X-Forwarded-For when present (set by reverse proxies), fall back to socket address
      const forwarded = req.headers['x-forwarded-for'];
      const clientIp = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim()) ?? req.socket.remoteAddress ?? '';
      this.connectionManager.trackSocketIp(ws, clientIp);
      logger.info({ ip: clientIp }, 'New WebSocket connection established');

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
   * Handles an incoming raw WebSocket message.
   * Parses the payload, builds a transport-specific context, and delegates to the dispatcher.
   * @param ws - The WebSocket connection that sent the message.
   * @param data - The raw message data buffer.
   */
  private async handleMessage(ws: WebSocket, data: Buffer): Promise<void> {
    let wsMessage: BaseInputMessage;
    try {
      wsMessage = JSON.parse(data.toString()) as BaseInputMessage;
    } catch {
      this.sendError(ws, 'Invalid JSON');
      return;
    }

    const connection = this.connectionManager.getConnectionForWebSocket(ws);

    // Translate WS wire format → CAL format: map requestId → correlationId, resolve conversationId from session
    const calMessage = {
      ...wsMessage,
      correlationId: wsMessage.requestId,
      conversationId: connection?.conversationId ?? '',
    } as CALInputMessage;

    const context: ChannelHandlerContext = {
      ws,
      connection,
      // Translate CAL response → WS wire format: map correlationId → requestId and inject sessionId
      send: (msg: any) => {
        const wsMsg: Record<string, unknown> = { ...msg };
        if (!wsMsg.requestId && wsMsg.correlationId) wsMsg.requestId = wsMsg.correlationId;
        if (!wsMsg.sessionId && connection?.id) wsMsg.sessionId = connection.id;
        this.send(ws, wsMsg as BaseOutputMessage);
      },
      sendError: (error: string, correlationId?: string) => this.sendError(ws, error, correlationId),
    };

    await this.dispatcher.dispatch(calMessage, context);
  }

  /**
   * Handles WebSocket disconnection.
   * Cleans up session resources and removes all associated mappings.
   * @param ws - The WebSocket connection that was disconnected.
   */
  private async handleDisconnect(ws: WebSocket): Promise<void> {
    const connection = this.connectionManager.getConnectionForWebSocket(ws);
    if (connection) {
      logger.info({ sessionId: connection.id, conversationId: connection.conversationId || undefined }, 'WebSocket connection closed, cleaning up session');
      await this.connectionManager.endSession(connection.id);
    } else {
      logger.info('WebSocket connection closed (no session found)');
    }
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

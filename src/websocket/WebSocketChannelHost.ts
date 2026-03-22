import 'reflect-metadata';
import { inject, singleton } from 'tsyringe';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { IncomingMessage } from 'http';
import { Connection, ConnectionManager } from '../channels/ConnectionManager';
import { ChannelHandlerDispatcher } from '../channels/ChannelHandlerDispatcher';
import { WsRateLimiter } from './WsRateLimiter';
import { logger } from '../utils/logger';
import type { BaseInputMessage, BaseOutputMessage } from './contracts/common';
import type { CALInputMessage } from '../channels/messages';
import type { ClientMessageHandlerContext } from '../channels/ClientMessageHandlerContext';
import { WebSocketConnection } from './WebSocketConnection';

/**
 * WebSocket server that manages client connections and message routing.
 * Handles authentication, session management, and conversation lifecycle.
 */
@singleton()
export class WebSocketChannelHost {
  private wss: WebSocketServer | null = null;
  private socketMap: Map<WebSocket, Connection> = new Map();
  private connectionMap: Map<string, WebSocket> = new Map();
  private socketIpMap: WeakMap<WebSocket, string> = new WeakMap();


  constructor(
    @inject(ChannelHandlerDispatcher) private readonly dispatcher: ChannelHandlerDispatcher,
    @inject(ConnectionManager) private readonly connectionManager: ConnectionManager,
    @inject(WsRateLimiter) private readonly rateLimiter: WsRateLimiter,
  ) {}

  /**
   * Initializes the WebSocket server and attaches it to an HTTP server.
   * @param server - The HTTP server to attach the WebSocket server to.
   */
  async initialize(server: Server): Promise<void> {
    const maxPayload = parseInt(process.env.WS_MAX_PAYLOAD_BYTES ?? String(10 * 1024 * 1024), 10);
    this.wss = new WebSocketServer({ server, path: '/ws', maxPayload });

    this.wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
      // Prefer X-Forwarded-For when present (set by reverse proxies), fall back to socket address
      const forwarded = req.headers['x-forwarded-for'];
      const clientIp = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim()) ?? req.socket.remoteAddress ?? '';
      this.trackSocketIp(ws, clientIp);
      logger.info({ ip: clientIp }, 'New WebSocket connection established');

      // Create a new WebSocketConnection and session for the authenticated client
      const wsConnection = new WebSocketConnection(ws, this.connectionManager);
      const sessionId = this.connectionManager.registerConnection(wsConnection);
      wsConnection.attachConnection(this.connectionManager.getConnection(sessionId));
      this.socketMap.set(ws, this.connectionManager.getConnection(sessionId));
      this.connectionMap.set(sessionId, ws);

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
   * Records the client IP address for a WebSocket connection.
   * Must be called during the HTTP upgrade handshake when the IP is available.
   * @param ws - The WebSocket connection.
   * @param ip - The client IP address.
   */
  trackSocketIp(ws: WebSocket, ip: string): void {
    this.socketIpMap.set(ws, ip);
  }

  /**
   * Returns the client IP address associated with a WebSocket connection.
   * @param ws - The WebSocket connection.
   * @returns The IP address, or an empty string if not tracked.
   */
  getSocketIp(ws: WebSocket): string {
    return this.socketIpMap.get(ws) ?? '';
  }

  /**
   * Retrieves the WebSocket connection associated with a given session ID.
   * @param sessionId - The session ID to look up.
   * @returns The WebSocket connection if found, otherwise undefined.
   */
  getWebSocketForSession(sessionId: string): WebSocket | undefined {
    return this.connectionMap.get(sessionId);
  }

  /**
   * Retrieves the session data associated with a given WebSocket connection.
   * @param ws - The WebSocket connection to look up.
   * @returns The session data if found, otherwise undefined.
   */
  getConnectionForWebSocket(ws: WebSocket): Connection | undefined {
    return this.socketMap.get(ws);
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

    if (wsMessage.type === 'auth') {
      const ip = this.getSocketIp(ws);
      if (!this.rateLimiter.tryConsume(ip)) {
        const retryAfter = this.rateLimiter.getRetryAfterSeconds(ip);
        logger.warn({ ip, retryAfter }, 'WebSocket auth rate limit exceeded');
        this.sendError(ws, 'Too many authentication attempts, please try again later', wsMessage.requestId);
        ws.close();
        return;
      }
    }

    const connection = this.getConnectionForWebSocket(ws);

    // Translate WS wire format → CAL format: map requestId → correlationId, resolve conversationId from session
    const calMessage = {
      ...wsMessage,
      correlationId: wsMessage.requestId,
      conversationId: connection?.conversationId ?? '',
    } as CALInputMessage;

    const context: ClientMessageHandlerContext = {
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
    const connection = this.getConnectionForWebSocket(ws);
    if (connection) {
      logger.info({ sessionId: connection.id, conversationId: connection.conversationId || undefined }, 'WebSocket connection closed, cleaning up session');
      await this.connectionManager.unregisterConnection(connection.id);
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

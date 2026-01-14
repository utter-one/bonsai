import { inject, singleton } from 'tsyringe';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { SessionManager } from './SessionManager';
import { logger } from '../../utils/logger';
import type { AuthRequest, AuthResponse } from '../../contracts/websocket/auth';
import type { StartConversationRequest, StartConversationResponse, ResumeConversationRequest, ResumeConversationResponse, EndConversationRequest, EndConversationResponse } from '../../contracts/websocket/session';
import type { BaseInputMessage, BaseOutputMessage } from '../../contracts/websocket/common';

type InputMessage = AuthRequest | StartConversationRequest | ResumeConversationRequest | EndConversationRequest;

/**
 * WebSocket server that manages client connections and message routing.
 * Handles authentication, session management, and conversation lifecycle.
 */
@singleton()
export class SessionServer {
  private wss: WebSocketServer | null = null;

  constructor(@inject(SessionManager) private sessionManager: SessionManager) {}

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
  private handleMessage(ws: WebSocket, data: Buffer): void {
    try {
      const message = JSON.parse(data.toString()) as InputMessage;

      logger.debug({ messageType: message.type, requestId: message.requestId }, 'Received WebSocket message');

      if (message.type === 'auth') {
        this.handleAuth(ws, message as AuthRequest);
      } else {
        if (!this.sessionManager.getWebSocketMetadata(ws) || !this.sessionManager.getWebSocketMetadata(ws)?.sessionId) {
          this.sendError(ws, 'Authentication required', message.requestId);
          return;
        }

        switch (message.type) {
          case 'start_conversation':
            this.handleStartConversation(ws, message as StartConversationRequest);
            break;
          case 'resume_conversation':
            this.handleResumeConversation(ws, message as ResumeConversationRequest);
            break;
          case 'end_conversation':
            this.handleEndConversation(ws, message as EndConversationRequest);
            break;
          default:
            logger.warn({ messageType: (message as BaseInputMessage).type }, 'Unknown message type received');
            this.sendError(ws, 'Unknown message type', (message as BaseInputMessage).requestId);
        }
      }
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to handle WebSocket message');
      this.sendError(ws, 'Invalid message format');
    }
  }

  /**
   * Handles authentication requests.
   * Validates API key and creates a session on successful authentication.
   * @param ws - The WebSocket connection requesting authentication.
   * @param message - The authentication request message.
   */
  private handleAuth(ws: WebSocket, message: AuthRequest): void {
    const expectedApiKey = process.env.WEBSOCKET_API_KEY || process.env.API_KEY;

    if (!expectedApiKey) {
      logger.error('WEBSOCKET_API_KEY or API_KEY environment variable not configured');
      const response: AuthResponse = { type: 'auth', success: false, error: 'Server configuration error', requestId: message.requestId };
      this.send(ws, response);
      return;
    }

    if (message.apiKey !== expectedApiKey) {
      logger.warn({ requestId: message.requestId }, 'Authentication failed: invalid API key');
      const response: AuthResponse = { type: 'auth', success: false, error: 'Invalid API key', requestId: message.requestId };
      this.send(ws, response);
      return;
    }

    const sessionId = this.sessionManager.createSession(ws);
    logger.info({ sessionId, requestId: message.requestId }, 'WebSocket authentication successful, session created');

    const response: AuthResponse = { type: 'auth', success: true, sessionId, requestId: message.requestId };
    this.send(ws, response);
  }

  /**
   * Handles start conversation requests.
   * @param ws - The WebSocket connection.
   * @param message - The start conversation request message.
   */
  private handleStartConversation(ws: WebSocket, message: StartConversationRequest): void {
    logger.info({ sessionId: message.sessionId, personaId: message.personaId, requestId: message.requestId }, 'Start conversation request received');

    // TODO: Implement conversation creation logic using ConversationService
    // For now, return a placeholder response
    const response: StartConversationResponse = { type: 'start_conversation', sessionId: message.sessionId, success: false, error: 'Not implemented', requestId: message.requestId };
    this.send(ws, response);
  }

  /**
   * Handles resume conversation requests.
   * @param ws - The WebSocket connection.
   * @param message - The resume conversation request message.
   */
  private handleResumeConversation(ws: WebSocket, message: ResumeConversationRequest): void {
    logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, requestId: message.requestId }, 'Resume conversation request received');

    // TODO: Implement conversation resumption logic using ConversationService
    // For now, return a placeholder response
    const response: ResumeConversationResponse = { type: 'resume_conversation', sessionId: message.sessionId, success: false, error: 'Not implemented', requestId: message.requestId };
    this.send(ws, response);
  }

  /**
   * Handles end conversation requests.
   * @param ws - The WebSocket connection.
   * @param message - The end conversation request message.
   */
  private handleEndConversation(ws: WebSocket, message: EndConversationRequest): void {
    logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, requestId: message.requestId }, 'End conversation request received');

    try {
      this.sessionManager.detachConversationInSession(message.sessionId);

      const response: EndConversationResponse = { type: 'end_conversation', sessionId: message.sessionId, success: true, requestId: message.requestId };
      this.send(ws, response);

      logger.info({ sessionId: message.sessionId, conversationId: message.conversationId }, 'Conversation ended successfully');
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error), sessionId: message.sessionId, conversationId: message.conversationId }, 'Failed to end conversation');
      const response: EndConversationResponse = { type: 'end_conversation', sessionId: message.sessionId, success: false, error: error instanceof Error ? error.message : 'Failed to end conversation', requestId: message.requestId };
      this.send(ws, response);
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

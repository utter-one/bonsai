import { inject, singleton } from 'tsyringe';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { SessionManager } from './SessionManager';
import { logger } from '../../utils/logger';
import type { AuthRequest, AuthResponse } from '../../contracts/websocket/auth';
import type { StartConversationRequest, StartConversationResponse, ResumeConversationRequest, ResumeConversationResponse, EndConversationRequest, EndConversationResponse } from '../../contracts/websocket/session';
import type { StartUserVoiceInputRequest, StartUserVoiceInputResponse, SendUserVoiceChunkRequest, SendUserVoiceChunkResponse, EndUserVoiceInputRequest, EndUserVoiceInputResponse, SendUserTextInputRequest, SendUserTextInputResponse } from '../../contracts/websocket/userInput';
import type { BaseInputMessage, BaseOutputMessage } from '../../contracts/websocket/common';
import { ConversationService } from '../ConversationService';
import { StageService } from '../StageService';
import { InvalidOperationError, NotFoundError } from '../../errors';
import { conversations, db } from '../../db';
import { eq } from 'drizzle-orm';

type InputMessage = AuthRequest | StartConversationRequest | ResumeConversationRequest | EndConversationRequest | StartUserVoiceInputRequest | SendUserVoiceChunkRequest | EndUserVoiceInputRequest | SendUserTextInputRequest;

/**
 * WebSocket server that manages client connections and message routing.
 * Handles authentication, session management, and conversation lifecycle.
 */
@singleton()
export class SessionServer {
  private wss: WebSocketServer | null = null;

  constructor(@inject(SessionManager) private sessionManager: SessionManager,
    @inject(ConversationService) private conversationService: ConversationService,
    @inject(StageService) private stageService: StageService) { }

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
        if (!this.sessionManager.getSessionForWebSocket(ws) || !this.sessionManager.getSessionForWebSocket(ws)?.id) {
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
          case 'start_user_voice_input':
            this.handleStartUserVoiceInput(ws, message as StartUserVoiceInputRequest);
            break;
          case 'send_user_voice_chunk':
            this.handleSendUserVoiceChunk(ws, message as SendUserVoiceChunkRequest);
            break;
          case 'end_user_voice_input':
            this.handleEndUserVoiceInput(ws, message as EndUserVoiceInputRequest);
            break;
          case 'send_user_text_input':
            this.handleSendUserTextInput(ws, message as SendUserTextInputRequest);
            break;
          default:
            logger.warn({ messageType: (message as BaseInputMessage).type }, 'Unknown message type received');
            this.sendError(ws, 'Unknown message type', (message as BaseInputMessage).requestId);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Failed to handle WebSocket message');
      this.sendError(ws, message);
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
  private async handleStartConversation(ws: WebSocket, message: StartConversationRequest): Promise<void> {
    logger.info({ sessionId: message.sessionId, personaId: message.personaId, requestId: message.requestId }, 'Start conversation request received');
    const metadata = this.sessionManager.getSessionForWebSocket(ws);
    if (!metadata) {
      throw new NotFoundError('Session not found');
    }
    if (metadata.conversationId) {
      throw new InvalidOperationError('A conversation is already active in this session');
    }

    try {
      // Get stage to extract projectId
      const stage = await this.stageService.getStageById(message.stageId);
      
      const conversation = await this.conversationService.createConversation({
        projectId: stage.projectId,
        userId: message.userId,
        stageId: message.stageId,
        clientId: metadata.id,
      });
      const conversationId = conversation.id;

      this.sessionManager.attachConversationToSession(message.sessionId, conversationId);

      logger.info({ sessionId: message.sessionId, conversationId }, 'Conversation created and attached to session');

      const response: StartConversationResponse = {
        type: 'start_conversation',
        sessionId: message.sessionId,
        success: true,
        conversationId,
        requestId: message.requestId
      };
      this.send(ws, response);

      // Start the conversation
      const sessionMetadata = this.sessionManager.getSessionForWebSocket(ws);
      await sessionMetadata.runner.startConversation();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create conversation';
      logger.error({ error: errorMessage, sessionId: message.sessionId }, 'Failed to create conversation');
      const response: StartConversationResponse = {
        type: 'start_conversation',
        sessionId: message.sessionId,
        success: false,
        error: errorMessage,
        requestId: message.requestId
      };
      this.send(ws, response);
    }
  }

  /**
   * Handles resume conversation requests.
   * @param ws - The WebSocket connection.
   * @param message - The resume conversation request message.
   */
  private async handleResumeConversation(ws: WebSocket, message: ResumeConversationRequest): Promise<void> {
    logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, requestId: message.requestId }, 'Resume conversation request received');
    const metadata = this.sessionManager.getSessionForWebSocket(ws);
    if (!metadata) {
      throw new NotFoundError('Session not found');
    }

    if (metadata.conversationId) {
      throw new InvalidOperationError('A conversation is already active in this session');
    }

    const conversation = await this.conversationService.getConversationById(message.conversationId);
    if (!conversation) {
      throw new NotFoundError('Conversation not found');
    }

    this.sessionManager.attachConversationToSession(message.sessionId, message.conversationId);

    // Return success response
    const response: ResumeConversationResponse = {
      type: 'resume_conversation',
      sessionId: message.sessionId,
      success: true,
      requestId: message.requestId
    };
    this.send(ws, response);

    // Resume the conversation
    const sessionMetadata = this.sessionManager.getSessionForWebSocket(ws);
    await sessionMetadata.runner.resumeConversation();
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
   * Handles start user voice input requests.
   * @param ws - The WebSocket connection.
   * @param message - The start user voice input request message.
   */
  private async handleStartUserVoiceInput(ws: WebSocket, message: StartUserVoiceInputRequest): Promise<void> {
    logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, requestId: message.requestId }, 'Start user voice input request received');

    try {
      const metadata = this.sessionManager.getSessionForWebSocket(ws);
      if (!metadata) {
        throw new NotFoundError('Session not found');
      }

      if (!metadata.conversationId) {
        throw new InvalidOperationError('No active conversation in this session');
      }

      if (metadata.conversationId !== message.conversationId) {
        throw new InvalidOperationError('Conversation ID mismatch');
      }

      await metadata.runner.startUserVoiceInput();

      const response: StartUserVoiceInputResponse = { type: 'start_user_voice_input', sessionId: message.sessionId, success: true, requestId: message.requestId };
      this.send(ws, response);

      logger.info({ sessionId: message.sessionId, conversationId: message.conversationId }, 'User voice input started successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start user voice input';
      logger.error({ error: errorMessage, sessionId: message.sessionId, conversationId: message.conversationId }, 'Failed to start user voice input');
      const response: StartUserVoiceInputResponse = { type: 'start_user_voice_input', sessionId: message.sessionId, success: false, error: errorMessage, requestId: message.requestId };
      this.send(ws, response);
    }
  }

  /**
   * Handles send user voice chunk requests.
   * @param ws - The WebSocket connection.
   * @param message - The send user voice chunk request message.
   */
  private async handleSendUserVoiceChunk(ws: WebSocket, message: SendUserVoiceChunkRequest): Promise<void> {
    logger.debug({ sessionId: message.sessionId, conversationId: message.conversationId, requestId: message.requestId }, 'Send user voice chunk request received');

    try {
      const metadata = this.sessionManager.getSessionForWebSocket(ws);
      if (!metadata) {
        throw new NotFoundError('Session not found');
      }

      if (!metadata.conversationId) {
        throw new InvalidOperationError('No active conversation in this session');
      }

      if (metadata.conversationId !== message.conversationId) {
        throw new InvalidOperationError('Conversation ID mismatch');
      }

      const audioBuffer = Buffer.from(message.audioData, 'base64');
      await metadata.runner.receiveUserVoiceData(audioBuffer);

      const response: SendUserVoiceChunkResponse = { type: 'send_user_voice_chunk', sessionId: message.sessionId, success: true, requestId: message.requestId };
      this.send(ws, response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to process voice chunk';
      logger.error({ error: errorMessage, sessionId: message.sessionId, conversationId: message.conversationId }, 'Failed to process voice chunk');
      const response: SendUserVoiceChunkResponse = { type: 'send_user_voice_chunk', sessionId: message.sessionId, success: false, error: errorMessage, requestId: message.requestId };
      this.send(ws, response);
    }
  }

  /**
   * Handles end user voice input requests.
   * @param ws - The WebSocket connection.
   * @param message - The end user voice input request message.
   */
  private async handleEndUserVoiceInput(ws: WebSocket, message: EndUserVoiceInputRequest): Promise<void> {
    logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, requestId: message.requestId }, 'End user voice input request received');

    try {
      const metadata = this.sessionManager.getSessionForWebSocket(ws);
      if (!metadata) {
        throw new NotFoundError('Session not found');
      }

      if (!metadata.conversationId) {
        throw new InvalidOperationError('No active conversation in this session');
      }

      if (metadata.conversationId !== message.conversationId) {
        throw new InvalidOperationError('Conversation ID mismatch');
      }

      await metadata.runner.stopUserVoiceInput();

      const response: EndUserVoiceInputResponse = { type: 'end_user_voice_input', sessionId: message.sessionId, success: true, requestId: message.requestId };
      this.send(ws, response);

      logger.info({ sessionId: message.sessionId, conversationId: message.conversationId }, 'User voice input ended successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to end user voice input';
      logger.error({ error: errorMessage, sessionId: message.sessionId, conversationId: message.conversationId }, 'Failed to end user voice input');
      const response: EndUserVoiceInputResponse = { type: 'end_user_voice_input', sessionId: message.sessionId, success: false, error: errorMessage, requestId: message.requestId };
      this.send(ws, response);
    }
  }

  /**
   * Handles send user text input requests.
   * @param ws - The WebSocket connection.
   * @param message - The send user text input request message.
   */
  private async handleSendUserTextInput(ws: WebSocket, message: SendUserTextInputRequest): Promise<void> {
    logger.info({ sessionId: message.sessionId, conversationId: message.conversationId, requestId: message.requestId }, 'Send user text input request received');

    try {
      const metadata = this.sessionManager.getSessionForWebSocket(ws);
      if (!metadata) {
        throw new NotFoundError('Session not found');
      }

      if (!metadata.conversationId) {
        throw new InvalidOperationError('No active conversation in this session');
      }

      if (metadata.conversationId !== message.conversationId) {
        throw new InvalidOperationError('Conversation ID mismatch');
      }

      await metadata.runner.receiveUserTextInput(message.text);

      const response: SendUserTextInputResponse = { type: 'send_user_text_input', sessionId: message.sessionId, success: true, requestId: message.requestId };
      this.send(ws, response);

      logger.info({ sessionId: message.sessionId, conversationId: message.conversationId }, 'User text input received successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to process text input';
      logger.error({ error: errorMessage, sessionId: message.sessionId, conversationId: message.conversationId }, 'Failed to process text input');
      const response: SendUserTextInputResponse = { type: 'send_user_text_input', sessionId: message.sessionId, success: false, error: errorMessage, requestId: message.requestId };
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

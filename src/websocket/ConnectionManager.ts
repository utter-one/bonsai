import { singleton, container } from "tsyringe";
import type { ConversationRunner } from "../services/live/ConversationRunner";
import { meta } from "zod/v4/core";
import { SessionSettings } from "./contracts/auth";
import { logger } from "../utils/logger";
import { ConversationEventData, ConversationEventType } from "../types/conversationEvents";

/** Session data associated with each WebSocket connection. */
export type Connection =
{ 
  /** Unique identifier for the session. */
  id: string,
  /** ID of the project this session is authenticated for. */
  projectId: string;
  /** ID of the conversation currently active in this session, empty string if none. */
  conversationId: string
  /** Conversation runner instance for managing the conversation. */
  runner: ConversationRunner;
  /** WebSocket connection associated with this session. */
  ws: WebSocket;
  /** Session settings configured during authentication. */
  sessionSettings: SessionSettings;
};

/**
 * Manages WebSocket sessions and their associated conversations.
 * Maintains bidirectional mappings between WebSocket connections, session IDs, and conversation IDs.
 */
@singleton()
export class ConnectionManager {
  /** Maps WebSocket connections to their metadata (sessionId and conversationId). */
  private socketMap: Map<WebSocket, Connection> = new Map();
  /** Maps session IDs to their WebSocket connections for quick lookup. */
  private connectionMap: Map<string, WebSocket> = new Map();

  /**
   * Creates a new session for a WebSocket connection.
   * @param ws - The WebSocket connection to create a session for.
   * @param projectId - The project ID this session is authenticated for.
   * @returns The generated session ID.
   */
  createSession(ws: WebSocket, projectId: string, sessionSettings?: SessionSettings): string {
    const sessionId = `session_${Math.random().toString(36).substr(2, 9)}`;
    this.socketMap.set(ws, { 
      id: sessionId, 
      projectId, 
      conversationId: null, 
      runner: null, 
      ws,
      sessionSettings: sessionSettings ?? { sendVoiceInput: true, sendTextInput: true, receiveVoiceOutput: true, receiveTranscriptionUpdates: true, receiveEvents: true }
    });
    this.connectionMap.set(sessionId, ws);
    return sessionId;
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
   * Attaches a conversation to an existing session.
   * @param sessionId - The session ID to attach the conversation to.
   * @param conversationId - The conversation ID to attach.
   * @throws Error if the session is not found.
   */
  async attachConversationToSession(sessionId: string, conversationId: string) {
    const socket = this.connectionMap.get(sessionId);
    if (!socket) {
      throw new Error('Session not found');
    }

    const session = this.socketMap.get(socket);
    if (session) {
      session.conversationId = conversationId;
      const { ConversationRunner } = await import('../services/live/ConversationRunner.js');
      session.runner = container.resolve(ConversationRunner);
      await session.runner.prepareConversation(conversationId, session, this.socketMap.get(socket).ws);
      this.socketMap.set(socket, session);
    }
  }

  /**
   * Detaches the current conversation from a session.
   * @param sessionId - The session ID to detach the conversation from.
   * @throws Error if the session is not found.
   */
  detachConversationInSession(sessionId: string) {
    const socket = this.connectionMap.get(sessionId);
    if (!socket) {
      throw new Error('Session not found');
    }

    const session = this.socketMap.get(socket);
    if (session) {
      session.conversationId = null;
      session.runner = null;
      this.socketMap.set(socket, session);
    }
  }

  /**
   * Ends a session and removes all associated mappings.
   * @param sessionId - The session ID to end.
   */
  endSession(sessionId: string) {
    const socket = this.connectionMap.get(sessionId);
    if (socket) {
      this.socketMap.delete(socket);
      this.connectionMap.delete(sessionId);
    }
  }

  /**
   * Sends a conversation event message to a connected WebSocket client if the client has enabled receiveEvents.
   * @param conversationId - The conversation ID to send the event for.
   * @param eventType - The type of conversation event.
   * @param eventData - The event data.
   * @param inputTurnId - Optional input turn ID.
   * @param outputTurnId - Optional output turn ID.
   */
  sendConversationEvent(conversationId: string, eventType: ConversationEventType, eventData: ConversationEventData, inputTurnId?: string, outputTurnId?: string): void {
    for (const [ws, connection] of this.socketMap.entries()) {
      if (connection.conversationId === conversationId && connection.sessionSettings.receiveEvents) {
        const message = { type: 'conversation_event', sessionId: connection.id, conversationId, eventType, eventData, inputTurnId, outputTurnId };
        try {
          ws.send(JSON.stringify(message));
        } catch (error) {
          logger.error({ error, conversationId, sessionId: connection.id }, 'Failed to send conversation event message');
        }
      }
    }
  }
}
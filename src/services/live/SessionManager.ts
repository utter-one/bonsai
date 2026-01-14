import { singleton } from "tsyringe";
import ws from 'ws'

/** Metadata associated with each WebSocket connection. */
export type WebSocketMetadata =
{ 
  /** Unique identifier for the session. */
  sessionId: string,
  /** ID of the conversation currently active in this session, empty string if none. */
  conversationId: string
};

/**
 * Manages WebSocket sessions and their associated conversations.
 * Maintains bidirectional mappings between WebSocket connections, session IDs, and conversation IDs.
 */
@singleton()
export class SessionManager {
  /** Maps WebSocket connections to their metadata (sessionId and conversationId). */
  private socketMap: Map<WebSocket, WebSocketMetadata> = new Map();
  /** Maps session IDs to their WebSocket connections for quick lookup. */
  private sessionMap: Map<string, WebSocket> = new Map();

  /**
   * Creates a new session for a WebSocket connection.
   * @param ws - The WebSocket connection to create a session for.
   * @returns The generated session ID.
   */
  createSession(ws: WebSocket) {
    const sessionId = `session_${Math.random().toString(36).substr(2, 9)}`;
    this.socketMap.set(ws, { sessionId, conversationId: '' });
    this.sessionMap.set(sessionId, ws);
    return sessionId;
  }

  /**
   * Attaches a conversation to an existing session.
   * @param sessionId - The session ID to attach the conversation to.
   * @param conversationId - The conversation ID to attach.
   * @throws Error if the session is not found.
   */
  attachConversationToSession(sessionId: string, conversationId: string) {
    const socket = this.sessionMap.get(sessionId);
    if (!socket) {
      throw new Error('Session not found');
    }

    const metadata = this.socketMap.get(socket);
    if (metadata) {
      metadata.conversationId = conversationId;
      this.socketMap.set(socket, metadata);
    }
  }

  /**
   * Detaches the current conversation from a session.
   * @param sessionId - The session ID to detach the conversation from.
   * @throws Error if the session is not found.
   */
  detachConversationInSession(sessionId: string) {
    const socket = this.sessionMap.get(sessionId);
    if (!socket) {
      throw new Error('Session not found');
    }

    const metadata = this.socketMap.get(socket);
    if (metadata) {
      metadata.conversationId = '';
      this.socketMap.set(socket, metadata);
    }
  }

  /**
   * Ends a session and removes all associated mappings.
   * @param sessionId - The session ID to end.
   */
  endSession(sessionId: string) {
    const socket = this.sessionMap.get(sessionId);
    if (socket) {
      this.socketMap.delete(socket);
      this.sessionMap.delete(sessionId);
    }
  }
}
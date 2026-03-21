import { singleton, container } from "tsyringe";
import type { WebSocket } from 'ws';
import type { ConversationRunner } from "../services/live/ConversationRunner";
import type { IClientChannel } from '../channels/IClientChannel';
import { SessionSettings } from "./contracts/auth";
import { logger } from "../utils/logger";
import { WebSocketChannel } from "./WebSocketChannel";

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
    /** Communication channel used to send messages to this session. */
    channel: IClientChannel;
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
  /** Tracks client IP addresses per WebSocket connection for rate limiting. Keys are GC'd automatically. */
  private socketIpMap: WeakMap<WebSocket, string> = new WeakMap();

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
   * Creates a new session for a WebSocket connection.
   * @param ws - The WebSocket connection to create a session for.
   * @param projectId - The project ID this session is authenticated for.
   * @returns The generated session ID.
   */
  createSession(ws: WebSocket, projectId: string, sessionSettings?: SessionSettings): string {
    const sessionId = `session_${Math.random().toString(36).substr(2, 9)}`;
    const connection: Connection = {
      id: sessionId,
      projectId,
      conversationId: null,
      runner: null,
      channel: null!,
      sessionSettings: sessionSettings ?? { sendVoiceInput: true, sendTextInput: true, receiveVoiceOutput: true, receiveTranscriptionUpdates: true, receiveEvents: true },
    };
    connection.channel = new WebSocketChannel(ws, connection);
    this.socketMap.set(ws, connection);
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
      await session.runner.prepareConversation(conversationId, session, session.channel);
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
   * Detaches the given conversation from all sessions that are currently associated with it.
   * Used by background jobs (e.g. timeout) that abort a conversation without going through a single session.
   * @param conversationId - The conversation ID to detach from all sessions.
   */
  detachConversationFromAllSessions(conversationId: string): void {
    for (const [ws, session] of this.socketMap.entries()) {
      if (session.conversationId === conversationId) {
        session.conversationId = null;
        session.runner = null;
        this.socketMap.set(ws, session);
      }
    }
  }

  /**
   * Ends a session, cleans up provider resources, and removes all associated mappings.
   * @param sessionId - The session ID to end.
   */
  async endSession(sessionId: string): Promise<void> {
    const socket = this.connectionMap.get(sessionId);
    if (socket) {
      const session = this.socketMap.get(socket);
      if (session?.runner) {
        try {
          await session.runner.cleanup();
        } catch (error) {
          logger.error({ sessionId, error: error instanceof Error ? error.message : String(error) }, 'Failed to clean up ConversationRunner during session end');
        }
      }
      this.socketMap.delete(socket);
      this.connectionMap.delete(sessionId);
    }
  }

  /**
   * Returns all active connections that are currently attached to the given conversation.
   * @param conversationId - The conversation ID to look up.
   */
  getConnectionsForConversation(conversationId: string): Connection[] {
    const result: Connection[] = [];
    for (const connection of this.socketMap.values()) {
      if (connection.conversationId === conversationId) {
        result.push(connection);
      }
    }
    return result;
  }
}

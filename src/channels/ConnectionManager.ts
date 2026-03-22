import { singleton, container } from "tsyringe";
import type { ConversationRunner } from "../services/live/ConversationRunner";
import type { IClientConnection } from './IClientConnection';
import { SessionSettings } from "../websocket/contracts/auth";
import { logger } from "../utils/logger";


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
    clientConnection: IClientConnection;
    /** Session settings configured during authentication. */
    sessionSettings: SessionSettings;
  };

/**
 * Manages WebSocket sessions and their associated conversations.
 * Maintains bidirectional mappings between WebSocket connections, session IDs, and conversation IDs.
 */
@singleton()
export class ConnectionManager {
  private connectionMap: Map<IClientConnection, Connection> = new Map();
  private idMap: Map<string, Connection> = new Map();

  /**
   * Creates a new session for a WebSocket connection.
   * @param ws - The WebSocket connection to create a session for.
   * @param projectId - The project ID this session is authenticated for.
   * @returns The generated session ID.
   */
  registerConnection(clientConnection: IClientConnection): string {
    if (!clientConnection) {
      throw new Error('Client connection is required to create a session');
    }

    const sessionId = `session_${Math.random().toString(36).substr(2, 9)}`;
    const connection: Connection = {
      id: sessionId,
      projectId: null,
      conversationId: null,
      runner: null,
      clientConnection,
      sessionSettings: { sendVoiceInput: true, sendTextInput: true, receiveVoiceOutput: true, receiveTranscriptionUpdates: true, receiveEvents: true },
    };

    this.connectionMap.set(clientConnection, connection);
    this.idMap.set(sessionId, connection);

    logger.info({ sessionId }, 'Session created for new WebSocket connection');
    return sessionId;
  }

  /**
   * Updates the project ID and session settings for an existing connection.
   * @param sessionId - The session ID of the connection to update.
   * @param projectId - The new project ID to associate with the connection.
   * @param sessionSettings - The new session settings to apply.
   */
  setConnectionProjectAndSettings(sessionId: string, projectId: string, sessionSettings: SessionSettings): void {
    const connection = this.idMap.get(sessionId);
    if (!connection) {
      throw new Error('Connection not found for session ID');
    }

    connection.projectId = projectId;
    connection.sessionSettings = sessionSettings;
    this.idMap.set(sessionId, connection);
  }

  /**
   * Retrieves the session data associated with a given session ID.
   * @param sessionId - The session ID to look up.
   * @returns The Connection object associated with the session ID, or null if not found.
   */
  getConnection(sessionId: string): Connection | null {
    return this.idMap.get(sessionId) || null;
  }

  /**
   * Attaches a conversation to an existing connection.
   * @param connectionId - The connection ID to attach the conversation to.
   * @param conversationId - The conversation ID to attach.
   * @throws Error if the connection is not found.
   */
  async attachConversationToConnection(connectionId: string, conversationId: string) {
    const connection = this.idMap.get(connectionId);
    if (!connection) {
      throw new Error('Connection not found');
    }

    connection.conversationId = conversationId;
    const { ConversationRunner } = await import('../services/live/ConversationRunner.js');
    connection.runner = container.resolve(ConversationRunner);
    await connection.runner.prepareConversation(conversationId, connection, connection.clientConnection);
    this.idMap.set(connectionId, connection);
  }

  /**
   * Detaches the current conversation from a connection.
   * @param connectionId - The connection ID to detach the conversation from.
   * @throws Error if the connection is not found.
   */
  detachConversationFromConnection(connectionId: string) {
    const connection = this.idMap.get(connectionId);
    if (!connection) {
      throw new Error('Connection not found');
    }

    connection.conversationId = null;
    connection.runner = null;
    this.idMap.set(connectionId, connection);
  }

  /**
   * Detaches the given conversation from all connections that are currently associated with it.
   * Used by background jobs (e.g. timeout) that abort a conversation without going through a single connection.
   * @param conversationId - The conversation ID to detach from all connections.
   */
  detachConversationFromConnections(conversationId: string): void {
    for (const [connectionId, connection] of this.idMap.entries()) {
      if (connection.conversationId === conversationId) {
        connection.conversationId = null;
        connection.runner = null;
        this.idMap.set(connectionId, connection);
      }
    }
  }

  /**
   * Ends a session, cleans up provider resources, and removes all associated mappings.
   * @param connectionId - The session ID to end.
   */
  async unregisterConnection(connectionId: string): Promise<void> {
    const connection = this.idMap.get(connectionId);
    if (connection) {

      if (connection.runner) {
        try {
          await connection.runner.cleanup();
        } catch (error) {
          logger.error({ sessionId: connectionId, error: error instanceof Error ? error.message : String(error) }, 'Failed to clean up ConversationRunner during session end');
        }
      }
      this.idMap.delete(connectionId);
      this.connectionMap.delete(connection.clientConnection);
    }
  }

  /**
   * Returns all active connections that are currently attached to the given conversation.
   * @param conversationId - The conversation ID to look up.
   */
  getConnectionsForConversation(conversationId: string): Connection[] {
    const result: Connection[] = [];
    for (const connection of this.idMap.values()) {
      if (connection.conversationId === conversationId) {
        result.push(connection);
      }
    }
    return result;
  }
}

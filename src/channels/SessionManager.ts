import { singleton, container } from "tsyringe";
import type { ConversationRunner } from "../services/live/ConversationRunner";
import type { IClientConnection } from './IClientConnection';
import { SessionSettings } from "./websocket/contracts/auth";
import { logger } from "../utils/logger";

/** Data associated with an active WebSocket session. */
export type Session = {
  /** Unique identifier for the session. */
  id: string;
  /** ID of the project this session is authenticated for. */
  projectId: string;
  /** ID of the conversation currently active in this session, null if none. */
  conversationId: string;
  /** Conversation runner instance for managing the conversation. */
  runner: ConversationRunner;
  /** Communication channel used to send messages to this session. */
  clientConnection: IClientConnection;
  /** Session settings configured during authentication. */
  sessionSettings: SessionSettings;
};

/**
 * Manages WebSocket sessions and their associated conversations.
 * Maintains bidirectional mappings between client connections, session IDs, and conversation IDs.
 */
@singleton()
export class SessionManager {
  private clientMap: Map<IClientConnection, Session> = new Map();
  private idMap: Map<string, Session> = new Map();

  /**
   * Creates a new session for a client connection.
   * @param clientConnection - The client connection to create a session for.
   * @returns The generated session ID.
   */
  registerSession(clientConnection: IClientConnection): string {
    if (!clientConnection) {
      throw new Error('Client connection is required to create a session');
    }

    const sessionId = `session_${Math.random().toString(36).substr(2, 9)}`;
    const session: Session = {
      id: sessionId,
      projectId: null,
      conversationId: null,
      runner: null,
      clientConnection,
      sessionSettings: { sendVoiceInput: true, sendTextInput: true, receiveVoiceOutput: true, receiveTranscriptionUpdates: true, receiveEvents: true, sendAudioFormat: 'pcm_16000' as const, receiveAudioFormat: 'pcm_16000' as const },
    };

    this.clientMap.set(clientConnection, session);
    this.idMap.set(sessionId, session);

    logger.info({ sessionId }, 'Session created for new WebSocket connection');
    return sessionId;
  }

  /**
   * Updates the project ID and session settings for an existing session.
   * @param sessionId - The session ID to update.
   * @param projectId - The new project ID to associate with the session.
   * @param sessionSettings - The new session settings to apply.
   */
  setSessionProjectAndSettings(sessionId: string, projectId: string, sessionSettings: SessionSettings): void {
    const session = this.idMap.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    session.projectId = projectId;
    session.sessionSettings = sessionSettings;
    this.idMap.set(sessionId, session);
  }

  /**
   * Retrieves the session data associated with a given session ID.
   * @param sessionId - The session ID to look up.
   * @returns The Session object, or null if not found.
   */
  getSession(sessionId: string): Session | null {
    return this.idMap.get(sessionId) || null;
  }

  /**
   * Attaches a conversation to an existing session.
   * @param sessionId - The session ID to attach the conversation to.
   * @param conversationId - The conversation ID to attach.
   * @throws Error if the session is not found.
   */
  async attachConversationToSession(sessionId: string, conversationId: string) {
    const session = this.idMap.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    session.conversationId = conversationId;
    const { ConversationRunner } = await import('../services/live/ConversationRunner.js');
    session.runner = container.resolve(ConversationRunner);
    await session.runner.prepareConversation(conversationId, session, session.clientConnection);
    this.idMap.set(sessionId, session);
  }

  /**
   * Detaches the current conversation from a session.
   * @param sessionId - The session ID to detach the conversation from.
   * @throws Error if the session is not found.
   */
  detachConversationFromSession(sessionId: string) {
    const session = this.idMap.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    session.conversationId = null;
    session.runner = null;
    this.idMap.set(sessionId, session);
  }

  /**
   * Detaches the given conversation from all sessions currently associated with it.
   * Used by background jobs (e.g. timeout) that abort a conversation without going through a single session.
   * @param conversationId - The conversation ID to detach from all sessions.
   */
  detachConversationFromSessions(conversationId: string): void {
    for (const [sessionId, session] of this.idMap.entries()) {
      if (session.conversationId === conversationId) {
        session.conversationId = null;
        session.runner = null;
        this.idMap.set(sessionId, session);
      }
    }
  }

  /**
   * Ends a session, cleans up provider resources, and removes all associated mappings.
   * @param sessionId - The session ID to end.
   */
  async unregisterSession(sessionId: string): Promise<void> {
    const session = this.idMap.get(sessionId);
    if (session) {
      if (session.runner) {
        try {
          await session.runner.cleanup();
        } catch (error) {
          logger.error({ sessionId, error: error instanceof Error ? error.message : String(error) }, 'Failed to clean up ConversationRunner during session end');
        }
      }
      this.idMap.delete(sessionId);
      this.clientMap.delete(session.clientConnection);
    }
  }

  /**
   * Returns all active sessions that are currently attached to the given conversation.
   * @param conversationId - The conversation ID to look up.
   */
  getSessionsForConversation(conversationId: string): Session[] {
    const result: Session[] = [];
    for (const session of this.idMap.values()) {
      if (session.conversationId === conversationId) {
        result.push(session);
      }
    }
    return result;
  }
}

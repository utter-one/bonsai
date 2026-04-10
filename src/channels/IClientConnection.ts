import type { CALOutputMessage } from './messages';
import type { ApiKeyChannel } from '../apiKeyFeatures';

/**
 * Abstract interface for a client connection channel.
 * This defines the contract for sending messages back to the client, abstracting away
 * transport-specific details. Implementations of this interface will handle the specifics
 * of how messages are transmitted (e.g., via WebSocket, HTTP response, etc.) while
 * providing a consistent method signature for the channel handlers to use when
 * responding to client messages.
 */
export interface IClientConnection {
  /** Identifies the transport type of this connection. Used for channel-level permission checks. */
  readonly connectionType: ApiKeyChannel;

  /**
   * Sends a message through the communication channel.
   * @param response The message to be sent.
   */
  sendMessage(response: CALOutputMessage): Promise<void>;

  /**
   * Closes the communication channel, performing any necessary cleanup.
   */
  close(): Promise<void>;
}

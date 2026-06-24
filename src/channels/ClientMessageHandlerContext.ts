import type { Session } from './SessionManager';
import type { CALOutputMessage } from './messages';
import type { AuthResponse } from './websocket/contracts/auth';
import type { SendUserVoiceChunkResponse } from './websocket/contracts/userInput';

/**
 * Discriminated union of all messages a handler may send back to a client.
 * Combines transport-agnostic CAL output messages with transport-specific responses.
 */
export type ClientOutputMessage = CALOutputMessage | AuthResponse | SendUserVoiceChunkResponse;

/**
 * Context provided to channel message handlers.
 * Contains the session metadata and dependencies needed for handling messages.
 */

export type ClientMessageHandlerContext = {
  session?: Session;
  send: (message: ClientOutputMessage) => void;
  sendError: (error: string, correlationId?: string) => void;
};

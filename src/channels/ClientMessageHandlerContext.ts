import type { Session } from './SessionManager';

/**
 * Context provided to channel message handlers.
 * Contains the session metadata and dependencies needed for handling messages.
 */

export type ClientMessageHandlerContext = {
  session?: Session;
  send: (message: any) => void;
  sendError: (error: string, correlationId?: string) => void;
};

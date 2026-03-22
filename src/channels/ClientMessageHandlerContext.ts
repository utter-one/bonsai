import type { Connection } from './ConnectionManager';

/**
 * Context provided to channel message handlers.
 * Contains the connection metadata and dependencies needed for handling messages.
 */

export type ClientMessageHandlerContext = {
  connection?: Connection;
  send: (message: any) => void;
  sendError: (error: string, correlationId?: string) => void;
};

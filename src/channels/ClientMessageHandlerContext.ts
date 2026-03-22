import type { WebSocket } from 'ws';
import type { Connection } from '../websocket/ConnectionManager';

/**
 * Context provided to channel message handlers.
 * Contains the connection metadata and dependencies needed for handling messages.
 */

export type ClientMessageHandlerContext = {
  connection?: Connection;
  /** Transport-specific socket. Only available in WebSocket handler context. */
  ws?: WebSocket;
  send: (message: any) => void;
  sendError: (error: string, correlationId?: string) => void;
};

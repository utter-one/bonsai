import type { WebSocket } from 'ws';
import type { Connection } from './ConnectionManager';
import type { BaseInputMessage } from './contracts/common';

/**
 * Context provided to message handlers.
 * Contains the connection metadata and dependencies needed for handling messages.
 */
export type WebSocketHandlerContext = {
  ws: WebSocket;
  connection?: Connection;
  send: (ws: WebSocket, message: any) => void;
  sendError: (ws: WebSocket, error: string, requestId?: string) => void;
};

/**
 * Base interface for WebSocket message handlers.
 * Each handler is responsible for processing a specific type of WebSocket message.
 */
export type WebSocketHandler<T extends BaseInputMessage = BaseInputMessage> = {
  /**
   * Handles the incoming message.
   * @param context - The handler context containing connection metadata and utilities.
   * @param message - The parsed message to handle.
   */
  handle(context: WebSocketHandlerContext, message: T): Promise<void> | void;
};

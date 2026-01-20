import type { WebSocket } from 'ws';
import type { Connection } from '../ConnectionManager';
import type { BaseInputMessage } from '../../contracts/websocket/common';

/**
 * Context provided to message handlers.
 * Contains the connection metadata and dependencies needed for handling messages.
 */
export type MessageHandlerContext = {
  ws: WebSocket;
  connection?: Connection;
  send: (ws: WebSocket, message: any) => void;
  sendError: (ws: WebSocket, error: string, requestId?: string) => void;
};

/**
 * Base interface for message handlers.
 * Each handler is responsible for processing a specific type of WebSocket message.
 */
export type MessageHandler<T extends BaseInputMessage = BaseInputMessage> = {
  /**
   * Handles the incoming message.
   * @param context - The handler context containing connection metadata and utilities.
   * @param message - The parsed message to handle.
   */
  handle(context: MessageHandlerContext, message: T): Promise<void> | void;
};

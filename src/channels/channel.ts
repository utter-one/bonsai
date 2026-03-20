import type { WebSocket } from 'ws';
import type { CALInputMessage, CALOutputMessage } from "./messages";
import type { Connection } from "../websocket/ConnectionManager";

/**
 * Abstract interface for a communication channel, defining the necessary methods for opening, closing, sending, and receiving data.
 */
export interface ICommunicationChannel {
    /**
     * Opens the communication channel, establishing necessary connections and preparing for data transmission.
     */
    open(): Promise<void>;

    /**
     * Closes the communication channel, ensuring all resources are released and connections are properly terminated.
     */
    close(): Promise<void>;

    /**
     * Receives a message from the communication channel.
     * @param request The message to be received.
     */
    receiveMessage(request: CALInputMessage): Promise<void>;

    /**
     * Sends a message through the communication channel.
     * @param response The message to be sent.
     */
    sendMessage(response: CALOutputMessage): Promise<void>;
}

/**
 * Context provided to channel message handlers.
 * Contains the connection metadata and dependencies needed for handling messages.
 */
export type ChannelHandlerContext = {
  connection?: Connection;
  /** Transport-specific socket. Only available in WebSocket handler context. */
  ws?: WebSocket;
  send: (message: any) => void;
  sendError: (error: string, correlationId?: string) => void;
};

/**
 * Base interface for channel message handlers.
 * Each handler is responsible for processing a specific type of WebSocket message.
 */
export type ChannelHandler<T extends Record<string, any> = Record<string, any>> = {
  /**
   * Handles the incoming message.
   * @param context - The handler context containing connection metadata and utilities.
   * @param message - The parsed message to handle.
   */
  handle(context: ChannelHandlerContext, message: T): Promise<void> | void;
};

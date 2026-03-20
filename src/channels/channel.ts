import { CALInputMessage, CALOutputMessage } from "./messages";

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

import type { Connection } from "../websocket/ConnectionManager";
import type { CALBaseInputMessage } from './messages';

/**
 * Context provided to channel message handlers.
 * Contains the connection metadata and dependencies needed for handling messages.
 */
export type ChannelHandlerContext = {
  connection?: Connection;
  send: (message: any) => void;
  sendError: (error: string, requestId?: string) => void;
};

/**
 * Base interface for channel message handlers.
 * Each handler is responsible for processing a specific type of WebSocket message.
 */
export type ChannelHandler<T extends CALBaseInputMessage = CALBaseInputMessage> = {
  /**
   * Handles the incoming message.
   * @param context - The handler context containing connection metadata and utilities.
   * @param message - The parsed message to handle.
   */
  handle(context: ChannelHandlerContext, message: T): Promise<void> | void;
};

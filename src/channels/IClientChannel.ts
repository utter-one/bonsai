import type { CALInputMessage, CALOutputMessage } from './messages';

/**
 * Abstract interface for a communication channel, defining the necessary methods for opening, closing, sending, and receiving data.
 */

export interface IClientChannel {
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

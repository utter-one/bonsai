import type { WebSocket } from 'ws';
import type { Connection } from './ConnectionManager';
import type { ICommunicationChannel } from '../channels/channel';
import type { CALInputMessage, CALOutputMessage } from '../channels/messages';
import { logger } from '../utils/logger';

/**
 * WebSocket-backed implementation of {@link ICommunicationChannel}.
 *
 * Translates CAL output messages to their WebSocket wire-format counterparts and
 * sends them directly to the associated WebSocket client.
 *
 * `open()` and `close()` are no-ops because the WebSocket lifecycle is managed
 * externally by {@link ConnectionManager}. `receiveMessage()` is also a no-op because
 * inbound routing is handled by the existing WebSocket handler pipeline.
 */
export class WebSocketChannel implements ICommunicationChannel {
  constructor(
    private readonly ws: WebSocket,
    private readonly connection: Connection,
  ) {}

  /** No-op: WebSocket lifecycle is managed by {@link ConnectionManager}. */
  async open(): Promise<void> {}

  /** No-op: WebSocket lifecycle is managed by {@link ConnectionManager}. */
  async close(): Promise<void> {}

  /** No-op: inbound messages are handled by the WebSocket handler pipeline. */
  async receiveMessage(_request: CALInputMessage): Promise<void> {}

  /**
   * Translates a CAL output message to its WebSocket wire-format equivalent and
   * sends it directly to the client.
   * @param msg - The CAL output message to transmit.
   */
  async sendMessage(msg: CALOutputMessage): Promise<void> {
    const { id: sessionId, conversationId, sessionSettings } = this.connection;

    switch (msg.type) {
      case 'user_transcribed_chunk': {
        if (!sessionSettings.receiveTranscriptionUpdates) return;
        this.send({
          type: 'user_transcribed_chunk',
          sessionId,
          conversationId,
          requestId: msg.correlationId,
          inputTurnId: msg.inputTurnId,
          chunkId: msg.chunkId,
          chunkText: msg.chunkText,
          ordinal: msg.ordinal,
          isFinal: msg.isFinal,
        });
        break;
      }

      case 'ai_transcribed_chunk': {
        if (!sessionSettings.receiveTranscriptionUpdates) return;
        this.send({
          type: 'ai_transcribed_chunk',
          sessionId,
          conversationId,
          requestId: msg.correlationId,
          outputTurnId: msg.outputTurnId,
          chunkId: msg.chunkId,
          chunkText: msg.chunkText,
          ordinal: msg.ordinal,
          isFinal: msg.isFinal,
        });
        break;
      }

      case 'start_ai_generation_output': {
        this.send({
          type: 'start_ai_generation_output',
          sessionId,
          conversationId,
          requestId: msg.correlationId,
          outputTurnId: msg.outputTurnId,
          expectVoice: msg.expectVoice,
        });
        break;
      }

      case 'send_ai_voice_chunk': {
        this.send({
          type: 'send_ai_voice_chunk',
          sessionId,
          conversationId,
          requestId: msg.correlationId,
          outputTurnId: msg.outputTurnId,
          audioData: msg.audioData.toString('base64'),
          audioFormat: msg.audioFormat,
          chunkId: msg.chunkId,
          ordinal: msg.ordinal,
          isFinal: msg.isFinal,
        });
        break;
      }

      case 'end_ai_generation_output': {
        this.send({
          type: 'end_ai_generation_output',
          sessionId,
          conversationId,
          requestId: msg.correlationId,
          outputTurnId: msg.outputTurnId,
          fullText: msg.fullText,
        });
        break;
      }

      case 'send_ai_image_output': {
        this.send({
          type: 'send_ai_image_output',
          sessionId,
          conversationId,
          requestId: msg.correlationId,
          outputTurnId: msg.outputTurnId,
          imageData: msg.imageData.toString('base64'),
          mimeType: msg.mimeType,
          sequenceNumber: msg.sequenceNumber,
        });
        break;
      }

      case 'send_ai_audio_output': {
        this.send({
          type: 'send_ai_audio_output',
          sessionId,
          conversationId,
          requestId: msg.correlationId,
          outputTurnId: msg.outputTurnId,
          audioData: msg.audioData.toString('base64'),
          audioFormat: msg.audioFormat,
          mimeType: msg.mimeType,
          sequenceNumber: msg.sequenceNumber,
          metadata: msg.metadata,
        });
        break;
      }

      case 'conversation_event': {
        if (!sessionSettings.receiveEvents) return;
        this.send({
          type: 'conversation_event',
          sessionId,
          conversationId,
          eventType: msg.eventType,
          eventData: msg.eventData,
          inputTurnId: msg.inputTurnId,
          outputTurnId: msg.outputTurnId,
        });
        break;
      }

      case 'conversation_event_update': {
        if (!sessionSettings.receiveEvents) return;
        this.send({
          type: 'conversation_event_update',
          sessionId,
          conversationId,
          eventType: msg.eventType,
          eventData: msg.eventData,
          inputTurnId: msg.inputTurnId,
          outputTurnId: msg.outputTurnId,
        });
        break;
      }

      default: {
        logger.warn({ type: (msg as CALOutputMessage & { type: string }).type }, 'WebSocketChannel received unexpected CAL output message type');
        break;
      }
    }
  }

  /** Serialises and sends a plain object to the WebSocket client. */
  private send(message: Record<string, unknown>): void {
    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      logger.error({ error, conversationId: this.connection.conversationId, sessionId: this.connection.id }, 'WebSocketChannel failed to send message');
    }
  }
}

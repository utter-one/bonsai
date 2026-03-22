import type { Session, SessionManager } from '../channels/SessionManager';
import type { IClientConnection } from '../channels/IClientConnection';
import type { CALOutputMessage } from '../channels/messages';
import { logger } from '../utils/logger';

/**
 * Encodes a binary audio frame for the audio DataChannel.
 *
 * Frame format: [2 bytes: turnId length as uint16 LE] [N bytes: turnId as UTF-8] [remaining: raw audio]
 */
function encodeAudioFrame(turnId: string, audioData: Buffer): Buffer {
  const turnIdBytes = Buffer.from(turnId, 'utf8');
  const header = Buffer.allocUnsafe(2);
  header.writeUInt16LE(turnIdBytes.length, 0);
  return Buffer.concat([header, turnIdBytes, audioData]);
}

/**
 * WebRTC DataChannel-backed implementation of {@link IClientConnection}.
 *
 * Uses two RTCDataChannel instances:
 * - `control`: ordered, reliable — all JSON messages (same wire protocol as WebSocket)
 * - `audio`: unordered, no retransmits — binary audio frames for AI voice output (lower latency)
 *
 * Binary audio frame format (audio channel, outbound AI voice):
 * [2 bytes: outputTurnId length as uint16 LE] [N bytes: outputTurnId as UTF-8] [remaining: raw audio]
 */
export class WebRTCConnection implements IClientConnection {
  private session: Session;

  constructor(
    private readonly controlChannel: RTCDataChannel,
    private readonly audioChannel: RTCDataChannel,
    private readonly sessionManager: SessionManager,
  ) {}

  /**
   * Attaches the session to this connection.
   * Must be called immediately after session registration.
   * @param session - The session to attach.
   */
  attachSession(session: Session): void {
    this.session = session;
  }

  /**
   * Closes both DataChannels and unregisters the session.
   */
  async close(): Promise<void> {
    if (this.controlChannel.readyState === 'open') {
      this.controlChannel.close();
    }
    if (this.audioChannel.readyState === 'open') {
      this.audioChannel.close();
    }
    if (this.session) {
      await this.sessionManager.unregisterSession(this.session.id);
    }
  }

  /**
   * Sends a raw JSON-serialisable message over the control DataChannel.
   * Used for handler-level responses (e.g. auth result, command acknowledgements).
   * @param message - The message object to serialise and send.
   */
  sendRawControl(message: Record<string, unknown>): void {
    this.sendControl(message);
  }

  /**
   * Sends an error message over the control DataChannel.
   * @param error - The error description.
   * @param requestId - Optional request ID for correlation.
   */
  sendError(error: string, requestId?: string): void {
    this.sendControl({ type: 'error', error, requestId });
  }

  /**
   * Translates a CAL output message and sends it over the appropriate DataChannel.
   * AI voice chunks go as binary frames on the audio DataChannel; all other messages
   * are JSON-serialised on the control DataChannel.
   * @param msg - The CAL output message to transmit.
   */
  async sendMessage(msg: CALOutputMessage): Promise<void> {
    const { id: sessionId, conversationId, sessionSettings } = this.session;

    switch (msg.type) {
      case 'user_transcribed_chunk': {
        if (!sessionSettings.receiveTranscriptionUpdates) return;
        this.sendControl({
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
        this.sendControl({
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
        this.sendControl({
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
        this.sendAudioFrame(msg.outputTurnId, msg.audioData);
        break;
      }

      case 'end_ai_generation_output': {
        this.sendControl({
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
        this.sendControl({
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
        this.sendControl({
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
        this.sendControl({
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
        this.sendControl({
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
        logger.warn({ type: (msg as CALOutputMessage & { type: string }).type }, 'WebRTCConnection received unexpected CAL output message type');
        break;
      }
    }
  }

  /** Serialises and sends a plain object over the control DataChannel. */
  private sendControl(message: Record<string, unknown>): void {
    try {
      this.controlChannel.send(JSON.stringify(message));
    } catch (error) {
      logger.error({ error, conversationId: this.session?.conversationId, sessionId: this.session?.id }, 'WebRTCConnection failed to send control message');
    }
  }

  /** Encodes and sends an audio frame over the audio DataChannel. */
  private sendAudioFrame(turnId: string, audioData: Buffer): void {
    try {
      const frame = encodeAudioFrame(turnId, audioData);
      this.audioChannel.send(frame);
    } catch (error) {
      logger.error({ error, conversationId: this.session?.conversationId, sessionId: this.session?.id }, 'WebRTCConnection failed to send audio frame');
    }
  }
}

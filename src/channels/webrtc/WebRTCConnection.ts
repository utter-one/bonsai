import type { Session, SessionManager } from '../SessionManager';
import type { IClientConnection } from '../IClientConnection';
import type { CALOutputMessage } from '../messages';
import { pcmSampleRate, isPcmFormat } from '../../services/audio/AudioFormatUtils';
import { logger } from '../../utils/logger';

/** Shape of PCM audio data pushed to an RTCAudioSource. */
type RTCAudioData = {
  samples: Int16Array;
  sampleRate: number;
  bitsPerSample?: number;
  channelCount?: number;
  numberOfFrames?: number;
};

/** Minimal interface for the node-webrtc RTCAudioSource nonstandard API. */
type RTCAudioSourceType = {
  createTrack(): MediaStreamTrack;
  onData(data: RTCAudioData): void;
};

/**
 * WebRTC-backed implementation of {@link IClientConnection}.
 *
 * Uses one named RTCDataChannel and one native WebRTC audio media track:
 * - `control` DataChannel (ordered, reliable): all JSON messages (same wire protocol as WebSocket)
 * - Audio media track (RTP/SRTP + Opus): bidirectional voice audio without DataChannel framing overhead
 *
 * AI voice output PCM frames are pushed into the RTCAudioSource, which handles Opus encoding
 * and RTP packetisation before delivering audio to the client's audio track.
 * Inbound user voice audio arrives via the RTCAudioSink wired in {@link WebRTCChannelHost}.
 */
export class WebRTCConnection implements IClientConnection {
  readonly connectionType = 'webrtc' as const;

  private session: Session;
  private activeInputTurnId: string | null = null;
  /** Leftover PCM bytes that did not fill a complete 10ms frame on the last push. */
  private audioRemainder: Buffer = Buffer.alloc(0);
  /** Queue of 10ms PCM frames waiting to be delivered to the RTCAudioSource. */
  private frameQueue: Int16Array[] = [];
  /** setInterval handle for the real-time audio scheduler (one frame per 10ms tick). */
  private schedulerInterval: ReturnType<typeof setInterval> | null = null;
  /** Sample rate negotiated when the scheduler was started; used by the interval callback. */
  private schedulerSampleRate: number = 0;

  constructor(
    private readonly controlChannel: RTCDataChannel,
    private readonly audioSource: RTCAudioSourceType,
    private readonly sessionManager: SessionManager,
  ) { }

  /**
   * Attaches the session to this connection.
   * Must be called immediately after session registration.
   * @param session - The session to attach.
   */
  attachSession(session: Session): void {
    this.session = session;
  }

  /**
   * Sets the active input turn ID for correlating inbound audio with a voice input turn.
   * @param turnId - The turn ID returned by the start_user_voice_input response.
   */
  setActiveInputTurnId(turnId: string): void {
    this.activeInputTurnId = turnId;
  }

  /**
   * Clears the active input turn ID when a voice input turn ends.
   */
  clearActiveInputTurnId(): void {
    this.activeInputTurnId = null;
  }

  /**
   * Returns the currently active input turn ID, or null if no voice input turn is active.
   */
  getActiveInputTurnId(): string | null {
    return this.activeInputTurnId;
  }

  /**
   * Closes the control DataChannel, stops the audio scheduler, and unregisters the session.
   * The audio media track lifecycle is managed by the RTCPeerConnection, not here.
   */
  async close(): Promise<void> {
    this.stopAudioScheduler();
    if (this.controlChannel.readyState === 'open') {
      this.controlChannel.close();
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
   * Translates a CAL output message and sends it over the appropriate channel.
   * AI voice chunks are pushed to the RTCAudioSource as PCM frames; all other messages
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
        this.pushAudioToTrack(msg.audioData);
        break;
      }

      case 'end_ai_generation_output': {
        // Flush any sub-frame audio remainder so the last few ms of the turn are heard.
        this.flushAudioRemainder();
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

  /**
   * Enqueues 10ms PCM frames from the incoming Buffer into the audio scheduler's frame queue.
   * Frames are dequeued and delivered to RTCAudioSource at real-time pace (one per 10ms tick)
   * to avoid overflowing the source's internal ring buffer.
   * Sub-frame leftover bytes are held in audioRemainder and prepended to the next chunk.
   */
  private pushAudioToTrack(audioData: Buffer): void {
    const { receiveAudioFormat } = this.session.sessionSettings;
    if (!receiveAudioFormat || !isPcmFormat(receiveAudioFormat)) {
      logger.warn({ receiveAudioFormat, sessionId: this.session?.id }, 'WebRTCConnection: receiveAudioFormat is not PCM, skipping audio frame');
      return;
    }
    const sampleRate = pcmSampleRate(receiveAudioFormat);
    const frameSamples = sampleRate / 100;   // 10ms per frame
    const frameBytes = frameSamples * 2;     // 16-bit LE = 2 bytes per sample

    this.ensureAudioScheduler(sampleRate);

    const combined = this.audioRemainder.length > 0
      ? Buffer.concat([this.audioRemainder, audioData])
      : audioData;

    let offset = 0;
    while (offset + frameBytes <= combined.length) {
      // .slice() gives the frame its own ArrayBuffer — node-wrtc validates samples.buffer.byteLength.
      const samples = new Int16Array(combined.buffer, combined.byteOffset + offset, frameSamples).slice();
      this.frameQueue.push(samples);
      offset += frameBytes;
    }

    this.audioRemainder = combined.length > offset
      ? Buffer.from(combined.buffer, combined.byteOffset + offset, combined.length - offset)
      : Buffer.alloc(0);
  }

  /**
   * Pads the current audioRemainder with silence to a full 10ms frame and enqueues it.
   * Called at end_ai_generation_output so the last few ms of a TTS turn are not silently dropped.
   */
  private flushAudioRemainder(): void {
    if (this.audioRemainder.length === 0 || this.schedulerSampleRate === 0) return;
    const frameSamples = this.schedulerSampleRate / 100;
    const frameBytes = frameSamples * 2;
    const padded = Buffer.alloc(frameBytes); // zero-filled = silence padding
    this.audioRemainder.copy(padded);
    this.frameQueue.push(new Int16Array(padded.buffer, 0, frameSamples));
    this.audioRemainder = Buffer.alloc(0);
  }

  /**
   * Starts the real-time audio scheduler if not already running.
   * The scheduler dequeues one 10ms frame per tick and delivers it to RTCAudioSource.
   */
  private ensureAudioScheduler(sampleRate: number): void {
    if (this.schedulerInterval !== null) return;
    this.schedulerSampleRate = sampleRate;
    this.schedulerInterval = setInterval(() => {
      const frame = this.frameQueue.shift();
      if (!frame) return;
      try {
        this.audioSource.onData({ samples: frame, sampleRate: this.schedulerSampleRate, bitsPerSample: 16, channelCount: 1 });
      } catch (err) {
        logger.error({ err, sessionId: this.session?.id }, 'WebRTCConnection audio scheduler error');
      }
    }, 10);
  }

  /**
   * Stops the real-time audio scheduler and discards any queued frames.
   * Called on connection close.
   */
  private stopAudioScheduler(): void {
    if (this.schedulerInterval !== null) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
    this.frameQueue = [];
    this.audioRemainder = Buffer.alloc(0);
  }
}

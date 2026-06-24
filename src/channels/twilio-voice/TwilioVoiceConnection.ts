import { WebSocket } from 'ws';
import type { Session, SessionManager } from '../SessionManager';
import type { IClientConnection } from '../IClientConnection';
import type { CALOutputMessage } from '../messages';
import { logger } from '../../utils/logger';

/**
 * Twilio Media Streams-backed implementation of {@link IClientConnection}.
 *
 * Each instance represents one inbound phone call session. Audio is exchanged via
 * the Twilio Media Streams WebSocket in µLaw 8 kHz format.
 *
 * Outbound CAL messages are handled as follows:
 * - `start_ai_generation_output`: sends a Twilio `clear` to flush any still-buffered audio from the
 *   previous turn (barge-in) and cancels all pending mark callbacks so stale echoes are ignored.
 *   When `flushBuffer` is explicitly `false` (filler delivery on non-barge-in turns), the `clear`
 *   is skipped to avoid unnecessary silence before the first audible filler chunk.
 * - `abort_ai_generation_output`: sends a Twilio `clear` to immediately flush buffered audio when
 *   VAD detects user barge-in, and cancels all pending mark callbacks.
 * - `send_ai_voice_chunk`: base64-encodes the µLaw audio payload and sends it to Twilio as a `media` event.
 *   Non-µLaw chunks are logged and dropped.
 * - `end_ai_generation_output`: sends a Twilio `mark` after the last audio chunk. Twilio echoes the mark
 *   once all buffered audio has finished playing, at which point `onAiTurnEnd` opens the next voice
 *   input turn. This prevents starting user input while audio is still buffered.
 * - All other message types are silently dropped (voice-only channel).
 */
export class TwilioVoiceConnection implements IClientConnection {
  readonly connectionType = 'twilio_voice' as const;

  private session: Session | null = null;
  private markCounter = 0;
  private pendingMarkName: string | null = null;
  isClosing = false;
  private pendingCloseResolve: (() => void) | null = null;

  constructor(
    /** The active Twilio Media Streams WebSocket for this call. */
    private readonly ws: WebSocket,
    /** The Twilio stream SID for this call, required by the Media Streams wire format. */
    private readonly streamSid: string,
    /** The Twilio call SID, used to end the call via REST API. */
    private readonly callSid: string,
    /** Twilio Account SID for REST API authentication. */
    private readonly accountSid: string,
    /** Twilio Auth Token for REST API authentication. */
    private readonly authToken: string,
    private readonly sessionManager: SessionManager,
    /** Called when Twilio confirms all buffered AI audio has finished playing. */
    private readonly onAiTurnEnd: () => Promise<void>,
    /**
     * Registers a callback to be invoked when Twilio sends back a `mark` event with the given name.
     * Used to defer `onAiTurnEnd` until audio playback is confirmed complete.
     */
    private readonly onRegisterMarkCallback: (name: string, cb: () => Promise<void>) => void,
    /**
     * Clears all pending mark callbacks. Called before sending a Twilio `clear` message so that
     * stale mark echoes (returned by Twilio after the buffer is flushed) are not mistakenly
     * processed as turn-end signals.
     */
    private readonly onClearMarkCallbacks: () => void,
  ) {}

  /**
   * Attaches the session record to this connection instance.
   * Must be called immediately after {@link SessionManager.registerSession}.
   * @param session - The session to attach.
   */
  attachSession(session: Session): void {
    this.session = session;
  }

 /**
     * Ends the call via Twilio REST API and closes the Media Streams WebSocket.
     * If a TTS mark is pending (audio still buffered at Twilio), waits for the mark
     * echo before hanging up so all audio finishes playing. Falls back to WebSocket
     * close if the REST API call fails.
     */
  async close(): Promise<void> {
    logger.info({ callSid: this.callSid, sessionId: this.session?.id }, 'TwilioVoice: close() called, ending call');

    if (this.pendingMarkName) {
      this.isClosing = true;
      this.onClearMarkCallbacks();
      await new Promise<void>((resolve) => {
        let done = false;
        const resolveOnce = () => {
          if (done) return;
          done = true;
          this.pendingCloseResolve = null;
          resolve();
        };
        this.pendingCloseResolve = resolveOnce;
        setTimeout(resolveOnce, 60000);
      });
    }

    try {
      const twilioModule = await import('twilio');
      const TwilioConstructor = (twilioModule as any).default?.Twilio ?? (twilioModule as any).Twilio ?? (twilioModule as any).default ?? twilioModule;
      const twilioClient = new TwilioConstructor(this.accountSid, this.authToken);

      await twilioClient.calls(this.callSid).update({ status: 'completed' });
      logger.info({ callSid: this.callSid }, 'TwilioVoice: call completed via REST API');
    } catch (error) {
      logger.warn({ callSid: this.callSid, error }, 'TwilioVoice: REST hangup failed, falling back to WebSocket close');
    }

    try {
      const { WebSocket: WS } = await import('ws');
      if (this.ws.readyState === WS.OPEN) {
        this.ws.close();
      }
    } catch {
      // ignore close errors
    }

    if (this.session) {
      await this.sessionManager.unregisterSession(this.session.id);
    }

    logger.info({ callSid: this.callSid, sessionId: this.session?.id }, 'TwilioVoice: close() completed');
  }

/**
     * Called by the host when a Twilio mark echo arrives during closing.
     * Resolves the pending close promise so the REST API hangup can proceed.
     * @param markName - The mark name from the Twilio echo.
     */
  handleMarkEcho(markName: string): void {
    if (!this.isClosing || this.pendingCloseResolve === null) return;
    if (markName !== this.pendingMarkName) return;
    logger.info({ callSid: this.callSid, markName }, 'TwilioVoice: mark echo received during close, proceeding with hangup');
    this.pendingCloseResolve();
  }

  /**
   * Sends a CAL output message toward the Twilio caller.
   *
   * `send_ai_voice_chunk` and `end_ai_generation_output` always have observable effects.
   * `start_ai_generation_output` sends a Twilio `clear` only when `flushBuffer` is not `false`.
   * @param msg - The CAL output message to transmit.
   */
  async sendMessage(msg: CALOutputMessage): Promise<void> {
    const canSend = this.ws.readyState === WebSocket.OPEN;

    switch (msg.type) {
      case 'start_ai_generation_output': {
        if (!canSend) return;
        if (msg.flushBuffer !== false) {
          this.onClearMarkCallbacks();
          this.ws.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }));
        }
        break;
      }
      case 'abort_ai_generation_output': {
        if (!canSend) return;
        this.onClearMarkCallbacks();
        this.ws.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }));
        break;
      }
      case 'send_ai_voice_chunk': {
        if (msg.audioFormat !== 'mulaw') {
          logger.warn({ audioFormat: msg.audioFormat, sessionId: this.session?.id }, 'TwilioVoice: received non-mulaw audio chunk, dropping');
          return;
        }
        if (!canSend) return;
        const payload = msg.audioData.toString('base64');
        const frame = JSON.stringify({ event: 'media', streamSid: this.streamSid, media: { payload } });
        this.ws.send(frame);
        break;
      }
      case 'end_ai_generation_output': {
        if (!canSend) return;
        const markName = `bonsai-turn-end-${this.markCounter++}`;
        this.pendingMarkName = markName;
        const markFrame = JSON.stringify({ event: 'mark', streamSid: this.streamSid, mark: { name: markName } });
        this.ws.send(markFrame);
        this.onRegisterMarkCallback(markName, this.onAiTurnEnd);
        break;
      }
      default:
        break;
    }
  }
}

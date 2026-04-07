import type { WebSocket } from 'ws';
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
 * - `send_ai_voice_chunk`: base64-encodes the µLaw audio payload and sends it to Twilio as a `media` event.
 *   Non-µLaw chunks are logged and dropped.
 * - `end_ai_generation_output`: sends a Twilio `mark` after the last audio chunk. Twilio echoes the mark
 *   once all buffered audio has finished playing, at which point `onAiTurnEnd` opens the next voice
 *   input turn. This prevents starting user input while audio is still buffered.
 * - All other message types are silently dropped (voice-only channel).
 */
export class TwilioVoiceConnection implements IClientConnection {
  readonly connectionType = 'twilio_voice' as const;

  private session: Session;
  private markCounter = 0;

  constructor(
    /** The active Twilio Media Streams WebSocket for this call. */
    private readonly ws: WebSocket,
    /** The Twilio stream SID for this call, required by the Media Streams wire format. */
    private readonly streamSid: string,
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
   * Closes the Media Streams WebSocket and unregisters the associated session.
   */
  async close(): Promise<void> {
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
  }

  /**
   * Sends a CAL output message toward the Twilio caller.
   *
   * Only `send_ai_voice_chunk` and `end_ai_generation_output` have observable effects.
   * @param msg - The CAL output message to transmit.
   */
  async sendMessage(msg: CALOutputMessage): Promise<void> {
    switch (msg.type) {
      case 'start_ai_generation_output': {
        // Flush any audio still buffered from the previous turn (barge-in scenario).
        // Clear pending mark callbacks first so the echoed marks Twilio sends back
        // in response to `clear` are not misinterpreted as turn-end signals.
        this.onClearMarkCallbacks();
        this.ws.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }));
        break;
      }
      case 'send_ai_voice_chunk': {
        if (msg.audioFormat !== 'mulaw') {
          logger.warn({ audioFormat: msg.audioFormat, sessionId: this.session?.id }, 'TwilioVoice: received non-mulaw audio chunk, dropping');
          return;
        }
        const payload = msg.audioData.toString('base64');
        const frame = JSON.stringify({ event: 'media', streamSid: this.streamSid, media: { payload } });
        this.ws.send(frame);
        break;
      }
      case 'end_ai_generation_output': {
        // Send a mark to Twilio; Twilio will echo it back once all buffered audio has played.
        // Only then do we open the next user voice input turn to avoid a race condition.
        const markName = `bonsai-turn-end-${this.markCounter++}`;
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

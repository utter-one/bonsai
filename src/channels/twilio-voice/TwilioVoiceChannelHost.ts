import { inject, singleton } from 'tsyringe';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { providers, apiKeys } from '../../db/schema';
import { SessionManager } from '../SessionManager';
import type { Session } from '../SessionManager';
import { ChannelHandlerDispatcher } from '../ChannelHandlerDispatcher';
import { IpRateLimiter } from '../../IpRateLimiter';
import { TwilioVoiceConnection } from './TwilioVoiceConnection';
import { twilioVoiceChannelProviderConfigSchema } from '../../services/providers/channel/TwilioVoiceChannelProvider';
import { sessionSettingsSchema } from '../websocket/contracts/auth';
import { logger } from '../../utils/logger';
import { asyncHandler } from '../../utils/asyncHandler';
import type { ApiKeySettings } from '../../apiKeyFeatures';
import type { CALInputMessage } from '../messages';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import * as _twilio from 'twilio';
const _twilioModule = (_twilio as any).default ?? _twilio;
const validateRequest = _twilioModule.validateRequest as typeof import('twilio').validateRequest;

/** Query param schema shared by both the HTTP webhook and the Media Streams WebSocket URL. */
const voiceQuerySchema = z.object({
  apiKey: z.string().min(1).describe('API key used to authenticate and identify the project'),
  stageId: z.string().min(1).describe('Stage ID to start new conversations at'),
  agentId: z.string().optional().describe('Optional agent ID override'),
  channelProviderId: z.string().min(1).describe('ID of the Twilio Voice channel provider record'),
});

/** Extra query param appended to the stream URL by the webhook handler. */
const streamQuerySchema = voiceQuerySchema.extend({
  from: z.string().min(1).describe("Caller's E.164 phone number, used as userId"),
});

/** Shape of a Twilio Media Streams WebSocket message. */
type TwilioStreamMessage = {
  event: 'connected' | 'start' | 'media' | 'stop' | 'mark' | 'dtmf' | string;
  sequenceNumber?: string;
  streamSid?: string;
  start?: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    mediaFormat?: { encoding: string; sampleRate: number; channels: number };
    customParameters?: Record<string, string>;
  };
  media?: {
    /** 'inbound' = from the caller, 'outbound' = Twilio→caller (echo of our sent audio). */
    track: 'inbound' | 'outbound' | string;
    chunk: string;
    timestamp: string;
    payload: string;
  };
  stop?: {
    accountSid: string;
    callSid: string;
  };
  /** Sent by Twilio after our server-sent mark message's audio has finished playing. */
  mark?: {
    name: string;
  };
  /** Touch-tone key press detected in the inbound stream (bidirectional streams only). */
  dtmf?: {
    track: string;
    digit: string;
  };
};

/** Default session settings for a voice-only Twilio call. */
const VOICE_SESSION_SETTINGS = sessionSettingsSchema.parse({
  sendVoiceInput: true,
  sendTextInput: false,
  receiveVoiceOutput: true,
  receiveTranscriptionUpdates: false,
  receiveEvents: false,
  sendAudioFormat: 'mulaw',
  receiveAudioFormat: 'mulaw',
});

/**
 * Channel host for Twilio Voice (Media Streams).
 *
 * Exposes two entry points:
 *
 * 1. `POST /api/twilio/voice/webhook` — receives the initial inbound call notification from
 *    Twilio and responds with TwiML that instructs Twilio to open a Media Streams WebSocket.
 *
 * 2. WebSocket `/api/twilio/voice/stream` — Twilio connects here immediately after the TwiML
 *    response and streams bidirectional µLaw 8 kHz audio for the duration of the call.
 *
 * ### Webhook URL format
 * ```
 * POST /api/twilio/voice/webhook?apiKey=xxx&stageId=yyy&channelProviderId=zzz[&agentId=aaa]
 * ```
 * Configure this in the Twilio console for the target phone number (Voice → A call comes in).
 *
 * ### Session lifecycle
 * - `connected` event → logged, no action
 * - `start` event → account SID is verified, session is created, `start_conversation` and
 *   `start_user_voice_input` are dispatched
 * - `media` events → raw µLaw audio is forwarded to the ConversationRunner
 * - `stop` event → session is unregistered
 */
@singleton()
export class TwilioVoiceChannelHost {
  private wss: WebSocketServer | null = null;

  constructor(
    @inject(SessionManager) private readonly sessionManager: SessionManager,
    @inject(ChannelHandlerDispatcher) private readonly dispatcher: ChannelHandlerDispatcher,
    @inject(IpRateLimiter) private readonly rateLimiter: IpRateLimiter,
  ) {}

  /**
   * Registers the Twilio Voice webhook route on the Express router.
   * @param router - The Express application or router to attach to.
   */
  registerRoutes(router: Router): void {
    router.post('/api/twilio/voice/webhook', asyncHandler(this.handleWebhook.bind(this)));
  }

  /**
   * Starts the Media Streams WebSocket server on the given HTTP server.
   * Must be called once after the HTTP server is created.
   * @param server - The HTTP server to attach to.
   */
  initialize(server: Server): void {
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = req.url ?? '';
      const pathname = url.includes('?') ? url.slice(0, url.indexOf('?')) : url;
      if (pathname !== '/api/twilio/voice/stream') return;
      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        this.wss!.emit('connection', ws, req);
      });
    });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleStreamConnection(ws, req);
    });
    logger.info('TwilioVoice: Media Streams WebSocket server initialized on /api/twilio/voice/stream');
  }

  /**
   * Handles an inbound Twilio Voice webhook (the initial call notification).
   *
   * Flow:
   * 1. Rate-limit check on caller IP.
   * 2. Validate query params and API key (incl. `twilio_voice` channel permission).
   * 3. Load channel provider and validate Twilio request signature.
   * 4. Build the Media Streams WebSocket URL with credentials embedded as query params.
   * 5. Return TwiML `<Connect><Stream>` to instruct Twilio to open the WebSocket.
   */
  private async handleWebhook(req: Request, res: Response): Promise<void> {
    const ip = (req.ip ?? req.socket.remoteAddress ?? '');

    if (!this.rateLimiter.tryConsume(ip)) {
      const retryAfter = this.rateLimiter.getRetryAfterSeconds(ip);
      logger.warn({ ip, retryAfter }, 'TwilioVoice webhook: rate limit exceeded');
      res.status(429).set('Retry-After', String(retryAfter)).send();
      return;
    }

    const queryResult = voiceQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      logger.warn({ issues: queryResult.error.issues }, 'TwilioVoice webhook: missing/invalid query params');
      res.status(400).send();
      return;
    }
    const { apiKey: rawApiKey, stageId, agentId, channelProviderId } = queryResult.data;

    const apiKeyRecord = await db.query.apiKeys.findFirst({ where: eq(apiKeys.key, rawApiKey) });
    if (!apiKeyRecord || !apiKeyRecord.isActive) {
      logger.warn('TwilioVoice webhook: invalid or inactive API key');
      res.status(401).send();
      return;
    }

    const { projectId, keySettings } = apiKeyRecord;

    if (keySettings?.allowedChannels && !keySettings.allowedChannels.includes('twilio_voice')) {
      logger.warn({ projectId }, 'TwilioVoice webhook: API key does not permit twilio_voice channel');
      res.status(403).send();
      return;
    }

    const providerRecord = await db.query.providers.findFirst({ where: eq(providers.id, channelProviderId) });
    if (!providerRecord || providerRecord.providerType !== 'channel') {
      logger.warn({ channelProviderId }, 'TwilioVoice webhook: channel provider not found or wrong type');
      res.status(400).send();
      return;
    }

    const configResult = twilioVoiceChannelProviderConfigSchema.safeParse(providerRecord.config);
    if (!configResult.success) {
      logger.error({ channelProviderId, issues: configResult.error.issues }, 'TwilioVoice webhook: channel provider config is invalid');
      res.status(500).send();
      return;
    }
    const { authToken } = configResult.data;

    const twilioSignature = req.headers['x-twilio-signature'] as string | undefined;
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const isValid = validateRequest(authToken, twilioSignature ?? '', fullUrl, req.body as Record<string, string>);
    if (!isValid) {
      logger.warn({ ip, projectId }, 'TwilioVoice webhook: invalid request signature');
      res.status(403).send();
      return;
    }

    const fromNumber: string = (req.body as Record<string, string>)?.From ?? '';
    if (!fromNumber) {
      logger.warn({ projectId }, 'TwilioVoice webhook: missing From field');
      res.status(400).send();
      return;
    }

    // Build the stream WebSocket URL — same query params plus "from" so the stream handler
    // knows the caller's phone number without an extra DB lookup.
    const wsProtocol = req.protocol === 'https' ? 'wss' : 'ws';
    const streamParams = new URLSearchParams({ apiKey: rawApiKey, stageId, channelProviderId, from: fromNumber });
    if (agentId) streamParams.set('agentId', agentId);
    const streamUrl = `${wsProtocol}://${req.get('host')}/api/twilio/voice/stream?${streamParams.toString()}`;

    logger.info({ projectId, streamUrl, from: fromNumber }, 'TwilioVoice: inbound call accepted, returning TwiML');

    res.set('Content-Type', 'text/xml').send(
      `<Response><Connect><Stream url="${streamUrl}" track="inbound_track"/></Connect></Response>`,
    );
  }

  /**
   * Handles a new Twilio Media Streams WebSocket connection.
   *
   * Validates credentials from the URL query string, then processes the Twilio event
   * sequence: `connected` → `start` → (`media`)* → `stop`.
   */
  private handleStreamConnection(ws: WebSocket, req: IncomingMessage): void {
    const clientIp = String(req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');

    if (!this.rateLimiter.tryConsume(clientIp)) {
      logger.warn({ ip: clientIp }, 'TwilioVoice stream: rate limit exceeded, closing');
      ws.close();
      return;
    }

    const urlObj = new URL(req.url ?? '/', 'http://localhost');
    const queryResult = streamQuerySchema.safeParse(Object.fromEntries(urlObj.searchParams));
    if (!queryResult.success) {
      logger.warn({ issues: queryResult.error.issues }, 'TwilioVoice stream: invalid query params');
      ws.close();
      return;
    }
    const { apiKey: rawApiKey, stageId, agentId, channelProviderId, from: fromNumber } = queryResult.data;

    // Credentials are validated asynchronously; wire up the message handler only after they pass.
    this.validateAndSetupStream(ws, clientIp, rawApiKey, stageId, agentId, channelProviderId, fromNumber);
  }

  /**
   * Validates API key + provider credentials and, if successful, wires up the Media Streams
   * message handler for the given WebSocket.
   */
  private async validateAndSetupStream(
    ws: WebSocket,
    clientIp: string,
    rawApiKey: string,
    stageId: string,
    agentId: string | undefined,
    channelProviderId: string,
    fromNumber: string,
  ): Promise<void> {
    try {
      const apiKeyRecord = await db.query.apiKeys.findFirst({ where: eq(apiKeys.key, rawApiKey) });
      if (!apiKeyRecord || !apiKeyRecord.isActive) {
        logger.warn({ ip: clientIp }, 'TwilioVoice stream: invalid or inactive API key');
        ws.close();
        return;
      }

      const { projectId, keySettings } = apiKeyRecord;

      if (keySettings?.allowedChannels && !keySettings.allowedChannels.includes('twilio_voice')) {
        logger.warn({ projectId }, 'TwilioVoice stream: API key does not permit twilio_voice channel');
        ws.close();
        return;
      }

      const providerRecord = await db.query.providers.findFirst({ where: eq(providers.id, channelProviderId) });
      if (!providerRecord || providerRecord.providerType !== 'channel') {
        logger.warn({ channelProviderId }, 'TwilioVoice stream: channel provider not found or wrong type');
        ws.close();
        return;
      }

      const configResult = twilioVoiceChannelProviderConfigSchema.safeParse(providerRecord.config);
      if (!configResult.success) {
        logger.error({ channelProviderId }, 'TwilioVoice stream: channel provider config is invalid');
        ws.close();
        return;
      }
      const config = configResult.data;

      // Per-connection mutable state managed by the message handler closure.
      let session: Session | null = null;
      let inputTurnId: string | null = null;
      const pendingMarkCallbacks = new Map<string, () => Promise<void>>();

      const tryCleanup = async () => {
        if (!session) return;
        const s = session;
        session = null;
        pendingMarkCallbacks.clear();
        await this.sessionManager.unregisterSession(s.id);
      };

      ws.on('close', async () => {
        await tryCleanup();
      });

      ws.on('message', async (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString()) as TwilioStreamMessage;
          await this.handleStreamMessage(msg, ws, config.accountSid, projectId, keySettings, stageId, agentId, fromNumber, {
            getSession: () => session,
            setSession: (s) => { session = s; },
            getInputTurnId: () => inputTurnId,
            setInputTurnId: (id) => { inputTurnId = id; },
            pendingMarkCallbacks,
            tryCleanup,
          });
        } catch (err) {
          logger.error({ error: err, ip: clientIp }, 'TwilioVoice stream: unhandled error processing message');
        }
      });

      logger.info({ ip: clientIp, projectId }, 'TwilioVoice stream: WebSocket connection validated and ready');
    } catch (err) {
      logger.error({ error: err, ip: clientIp }, 'TwilioVoice stream: error during connection setup');
      ws.close();
    }
  }

  /**
   * Processes a single Twilio Media Streams event for a validated connection.
   */
  private async handleStreamMessage(
    msg: TwilioStreamMessage,
    ws: WebSocket,
    expectedAccountSid: string,
    projectId: string,
    keySettings: ApiKeySettings | null,
    stageId: string,
    agentId: string | undefined,
    fromNumber: string,
    state: {
      getSession: () => Session | null;
      setSession: (s: Session) => void;
      getInputTurnId: () => string | null;
      setInputTurnId: (id: string | null) => void;
      pendingMarkCallbacks: Map<string, () => Promise<void>>;
      tryCleanup: () => Promise<void>;
    },
  ): Promise<void> {
    switch (msg.event) {
      case 'connected': {
        logger.info({ projectId }, 'TwilioVoice stream: connected event received');
        break;
      }

      case 'start': {
        const startData = msg.start;
        if (!startData) return;

        if (startData.accountSid !== expectedAccountSid) {
          logger.warn({ projectId, receivedAccountSid: startData.accountSid }, 'TwilioVoice stream: accountSid mismatch, closing');
          ws.close();
          return;
        }

        const streamSid = startData.streamSid;

        const onAiTurnEnd = async () => {
          const currentSession = state.getSession();
          if (!currentSession) return;
          const newId = await this.dispatchStartUserVoiceInput(currentSession);
          if (newId) state.setInputTurnId(newId);
        };

        const registerMarkCallback = (name: string, cb: () => Promise<void>) => {
          state.pendingMarkCallbacks.set(name, cb);
        };

        const connection = new TwilioVoiceConnection(ws, streamSid, this.sessionManager, onAiTurnEnd, registerMarkCallback);
        const sessionId = this.sessionManager.registerSession(connection);
        const session = this.sessionManager.getSession(sessionId);
        connection.attachSession(session);
        this.sessionManager.setSessionProjectAndSettings(sessionId, projectId, VOICE_SESSION_SETTINGS, keySettings ?? null);
        state.setSession(session);

        logger.info({ sessionId, projectId, streamSid, from: fromNumber }, 'TwilioVoice: new voice session created');

        const startMsg: CALInputMessage = { type: 'start_conversation', userId: fromNumber, stageId, agentId, correlationId: undefined };
        await this.dispatcher.dispatch(startMsg, this.buildContext(session));

        const inputTurnId = await this.dispatchStartUserVoiceInput(session);
        state.setInputTurnId(inputTurnId);
        break;
      }

      case 'media': {
        // Only process inbound audio (from the caller). Outbound is our own sent audio echoed back.
        if (msg.media?.track !== 'inbound') break;
        const currentSession = state.getSession();
        const currentInputTurnId = state.getInputTurnId();
        if (!currentSession?.runner || !currentInputTurnId) break;

        const buffer = Buffer.from(msg.media.payload, 'base64');
        await currentSession.runner.receiveUserVoiceData(currentInputTurnId, buffer);
        break;
      }

      case 'mark': {
        const markName = msg.mark?.name;
        if (markName) {
          const cb = state.pendingMarkCallbacks.get(markName);
          if (cb) {
            state.pendingMarkCallbacks.delete(markName);
            await cb();
          }
        }
        break;
      }

      case 'dtmf': {
        logger.info({ projectId, digit: msg.dtmf?.digit, track: msg.dtmf?.track }, 'TwilioVoice stream: DTMF digit received');
        break;
      }

      case 'stop': {
        logger.info({ projectId }, 'TwilioVoice stream: stop event received, ending session');
        await state.tryCleanup();
        break;
      }

      default:
        break;
    }
  }

  /**
   * Dispatches a `start_user_voice_input` CAL message and captures the resulting `inputTurnId`.
   * @param session - The session to start the voice input turn for.
   * @returns The new input turn ID, or null if the dispatch failed.
   */
  private async dispatchStartUserVoiceInput(session: Session): Promise<string | null> {
    if (!session.conversationId) {
      logger.warn({ sessionId: session.id }, 'TwilioVoice: cannot start voice input turn — no active conversation');
      return null;
    }

    let capturedInputTurnId: string | null = null;
    const context: ClientMessageHandlerContext = {
      session,
      send: (msg: any) => {
        if (msg.type === 'start_user_voice_input' && msg.success && msg.inputTurnId) {
          capturedInputTurnId = msg.inputTurnId;
        }
      },
      sendError: (error: string) => { logger.warn({ sessionId: session.id, error }, 'TwilioVoice: start_user_voice_input error'); },
    };

    await this.dispatcher.dispatch({ type: 'start_user_voice_input', conversationId: session.conversationId, correlationId: undefined }, context);
    return capturedInputTurnId;
  }

  /**
   * Builds a minimal {@link ClientMessageHandlerContext} for general dispatches (e.g. `start_conversation`).
   * @param session - The session to build context for.
   */
  private buildContext(session: Session): ClientMessageHandlerContext {
    return {
      session,
      send: () => { /* responses flow through TwilioVoiceConnection.sendMessage */ },
      sendError: (error: string) => { logger.warn({ sessionId: session?.id, error }, 'TwilioVoice dispatcher error'); },
    };
  }
}

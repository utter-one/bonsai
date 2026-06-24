import { inject, singleton } from 'tsyringe';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
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
import { ConversationService } from '../../services/ConversationService';
import { SYSTEM_CONTEXT } from '../../services/RequestContext';
import { ProjectService } from '../../services/ProjectService';
import { UserService } from '../../services/UserService';
import { SecretRefUtils } from '../../services/secrets/SecretRefUtils';
import { twilioVoiceCallBodySchema, twilioVoiceCallResponseSchema } from '../../http/contracts/twilio-voice-outgoing';
import type { TwilioVoiceCallResponse } from '../../http/contracts/twilio-voice-outgoing';
import * as _twilio from 'twilio';
const _twilioModule = (_twilio as any).default ?? _twilio;
const validateRequest = _twilioModule.validateRequest as typeof import('twilio').validateRequest;
const { VoiceResponse } = _twilioModule.twiml as typeof import('twilio').twiml;

/** Query param schema shared by both the HTTP webhook and the Media Streams WebSocket URL. */
const voiceQuerySchema = z.object({
  apiKey: z.string().min(1).describe('API key used to authenticate and identify the project'),
  stageId: z.string().min(1).optional().describe('Stage ID to start new conversations at. When omitted, falls back to the project-level default starting stage.'),
  agentId: z.string().optional().describe('Optional agent ID override'),
  channelProviderId: z.string().min(1).describe('ID of the Twilio Voice channel provider record'),
});

/** Credentials delivered via Twilio `<Parameter>` elements in the `start` event's customParameters. */
const streamCustomParamsSchema = voiceQuerySchema.extend({
  from: z.string().min(1).describe("Caller's E.164 phone number, used as userId"),
  outgoingConversationId: z.string().optional().describe('Pre-created conversation ID for outgoing calls — set by the voice webhook handler and delivered to the stream connection'),
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
  /** Maps callSid → conversationId for in-flight outgoing calls awaiting the Twilio webhook. */
  private readonly pendingOutboundCalls = new Map<string, string>();

  constructor(
    @inject(SessionManager) private readonly sessionManager: SessionManager,
    @inject(ChannelHandlerDispatcher) private readonly dispatcher: ChannelHandlerDispatcher,
    @inject(IpRateLimiter) private readonly rateLimiter: IpRateLimiter,
    @inject(ConversationService) private readonly conversationService: ConversationService,
    @inject(ProjectService) private readonly projectService: ProjectService,
    @inject(UserService) private readonly userService: UserService,
    @inject(SecretRefUtils) private readonly secretRefUtils: SecretRefUtils,
  ) {}

  /**
   * Returns OpenAPI path definitions for the outgoing call endpoint.
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/twilio/voice/call',
        tags: ['Twilio Voice'],
        summary: 'Initiate an outgoing Twilio Voice call',
        description: 'Places an outbound call to the specified phone number using the given Twilio Voice channel provider. A conversation record is created immediately. The call session is established asynchronously when the callee answers and Twilio fires the voice webhook. The voice webhook URL is passed directly as the `url` parameter unless the provider has an `applicationSid` configured.',  
        security: [],
        request: {
          query: voiceQuerySchema,
          body: { content: { 'application/json': { schema: twilioVoiceCallBodySchema } } },
        },
        responses: {
          201: { description: 'Call initiated and conversation pre-created', content: { 'application/json': { schema: twilioVoiceCallResponseSchema } } },
          400: { description: 'Missing or invalid parameters' },
          401: { description: 'Invalid or inactive API key' },
          403: { description: 'API key does not permit twilio_voice channel' },
          422: { description: 'No default stage available' },
          502: { description: 'Twilio REST call creation failed' },
        },
      },
    ];
  }

  /**
   * Registers the Twilio Voice webhook route on the Express router.
   * @param router - The Express application or router to attach to.
   */
  registerRoutes(router: Router): void {
    router.post('/api/twilio/voice/webhook', asyncHandler(this.handleWebhook.bind(this)));
    router.post('/api/twilio/voice/call', asyncHandler(this.handleOutgoingCall.bind(this)));
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
   * 4. Build the Media Streams WebSocket URL and pass credentials as `<Parameter>` elements.
   * 5. Return TwiML `<Connect><Stream>` to instruct Twilio to open the WebSocket.
   *
   * Credentials are passed as TwiML `<Parameter>` elements (delivered via `start.customParameters`)
   * rather than URL query params, because proxies commonly strip WebSocket upgrade query strings.
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

    const rawConfig = await this.secretRefUtils.resolveObject(providerRecord.config as Record<string, unknown>);
    const configResult = twilioVoiceChannelProviderConfigSchema.safeParse(rawConfig);
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

    const callDirection = (req.body as Record<string, string>)?.Direction ?? 'inbound';
    const callSid = (req.body as Record<string, string>)?.CallSid ?? '';

    let fromNumber: string;
    let outgoingConversationId: string | undefined;

    if (callDirection === 'outbound-api') {
      // Outgoing call: the callee is the "user"; correlate with pre-created conversation via callSid
      fromNumber = (req.body as Record<string, string>)?.To ?? '';
      outgoingConversationId = callSid ? this.pendingOutboundCalls.get(callSid) : undefined;
      if (outgoingConversationId) {
        this.pendingOutboundCalls.delete(callSid);
      }
      if (!fromNumber) {
        logger.warn({ projectId }, 'TwilioVoice webhook: missing To field for outbound call');
        res.status(400).send();
        return;
      }
    } else {
      fromNumber = (req.body as Record<string, string>)?.From ?? '';
      if (!fromNumber) {
        logger.warn({ projectId }, 'TwilioVoice webhook: missing From field');
        res.status(400).send();
        return;
      }
    }

    // Credentials are passed as <Parameter> child elements instead of URL query params.
    // Proxies commonly strip query strings from WebSocket upgrade requests, making URL
    // params unreliable. Twilio delivers <Parameter> values in start.customParameters.
    const wsProtocol = req.protocol === 'https' ? 'wss' : 'ws';
    const streamUrl = `${wsProtocol}://${req.get('host')}/api/twilio/voice/stream`;

    logger.info({ projectId, streamUrl, from: fromNumber, direction: callDirection }, 'TwilioVoice: call accepted, returning TwiML');

    const twiml = new VoiceResponse();
    const stream = twiml.connect().stream({ url: streamUrl, track: 'inbound_track' });
    stream.parameter({ name: 'apiKey', value: rawApiKey });
    if (stageId) stream.parameter({ name: 'stageId', value: stageId });
    stream.parameter({ name: 'channelProviderId', value: channelProviderId });
    stream.parameter({ name: 'from', value: fromNumber });
    if (agentId) stream.parameter({ name: 'agentId', value: agentId });
    if (outgoingConversationId) stream.parameter({ name: 'outgoingConversationId', value: outgoingConversationId });
    res.set('Content-Type', 'text/xml').send(twiml.toString());
  }

  /**
   * Handles a new Twilio Media Streams WebSocket connection.
   *
   * Rate-limits the connection and wires up the message handler. Credential validation
   * is deferred to the `start` event, where Twilio delivers them via `customParameters`.
   *
   * Event sequence: `connected` → `start` → (`media` | `mark` | `dtmf`)* → `stop`.
   */
  private handleStreamConnection(ws: WebSocket, req: IncomingMessage): void {
    const clientIp = String(req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');

    if (!this.rateLimiter.tryConsume(clientIp)) {
      logger.warn({ ip: clientIp }, 'TwilioVoice stream: rate limit exceeded, closing');
      ws.close();
      return;
    }

    // Per-connection mutable state.
    let session: Session | null = null;
    let connection: TwilioVoiceConnection | null = null;
    let inputTurnId: string | null = null;
    const pendingMarkCallbacks = new Map<string, () => Promise<void>>();

    const tryCleanup = async () => {
      if (!session) return;
      const s = session;
      session = null;
      pendingMarkCallbacks.clear();
      await this.sessionManager.unregisterSession(s.id);
    };

    ws.on('close', async () => { await tryCleanup(); });

    ws.on('message', async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as TwilioStreamMessage;

        switch (msg.event) {
          case 'connected': {
            logger.info({ ip: clientIp }, 'TwilioVoice stream: connected event received');
            break;
          }

          case 'start': {
            if (session) {
              logger.warn({ ip: clientIp }, 'TwilioVoice stream: duplicate start event, ignoring');
              break;
            }
            const startData = msg.start;
            if (!startData) break;

            // Read credentials from customParameters set in the webhook TwiML.
            const credsResult = streamCustomParamsSchema.safeParse(startData.customParameters ?? {});
            if (!credsResult.success) {
              logger.warn({ ip: clientIp, issues: credsResult.error.issues }, 'TwilioVoice stream: missing or invalid customParameters in start event');
              ws.close();
              return;
            }
            const { apiKey: rawApiKey, stageId, agentId, channelProviderId, from: fromNumber, outgoingConversationId } = credsResult.data;

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

            const rawConfig = await this.secretRefUtils.resolveObject(providerRecord.config as Record<string, unknown>);
            const configResult = twilioVoiceChannelProviderConfigSchema.safeParse(rawConfig);
            if (!configResult.success) {
              logger.error({ channelProviderId }, 'TwilioVoice stream: channel provider config is invalid');
              ws.close();
              return;
            }
            const config = configResult.data;

            if (startData.accountSid !== config.accountSid) {
              logger.warn({ projectId, receivedAccountSid: startData.accountSid }, 'TwilioVoice stream: accountSid mismatch, closing');
              ws.close();
              return;
            }

            const onAiTurnEnd = async () => {
              if (!session) return;
              const newId = await this.dispatchStartUserVoiceInput(session);
              if (newId) inputTurnId = newId;
            };
            const registerMarkCallback = (name: string, cb: () => Promise<void>) => { pendingMarkCallbacks.set(name, cb); };
            const clearMarkCallbacks = () => { pendingMarkCallbacks.clear(); };

            const conn = new TwilioVoiceConnection(ws, startData.streamSid, startData.callSid, config.accountSid, config.authToken, this.sessionManager, onAiTurnEnd, registerMarkCallback, clearMarkCallbacks);
            connection = conn;
            const sessionId = this.sessionManager.registerSession(connection);
            const newSession = this.sessionManager.getSession(sessionId);
            connection.attachSession(newSession);
            this.sessionManager.setSessionProjectAndSettings(sessionId, projectId, VOICE_SESSION_SETTINGS, keySettings ?? null);
            session = newSession;

            logger.info({ sessionId, projectId, streamSid: startData.streamSid, from: fromNumber }, 'TwilioVoice: new voice session created');

            const startMsg: CALInputMessage = { type: 'start_conversation', userId: fromNumber, stageId, agentId, correlationId: undefined, existingConversationId: outgoingConversationId };
            await this.dispatcher.dispatch(startMsg, this.buildContext(session));

            inputTurnId = await this.dispatchStartUserVoiceInput(session);
            break;
          }

          case 'media': {
            // Only process inbound audio (from the caller). Outbound is our own sent audio echoed back.
            if (msg.media?.track !== 'inbound') break;
            if (!session?.runner) break;
            // In VAD mode the runner ignores inputTurnId entirely (VAD owns the turn lifecycle),
            // so always forward audio once a session exists. In non-VAD mode inputTurnId must have
            // been captured from a successful start_user_voice_input; if not yet available the
            // runner will silently drop audio in awaiting_user_input state.
            const buffer = Buffer.from(msg.media.payload, 'base64');
            await session.runner.receiveUserVoiceData(inputTurnId ?? '', buffer);
            break;
          }

          case 'mark': {
            const markName = msg.mark?.name;
            if (markName) {
              if (connection?.isClosing) {
                connection.handleMarkEcho(markName);
              } else {
                session?.runner?.notifyAudioPlaybackEnded();
                const cb = pendingMarkCallbacks.get(markName);
                if (cb) {
                  pendingMarkCallbacks.delete(markName);
                  await cb();
                }
              }
            }
            break;
          }

          case 'dtmf': {
            logger.info({ digit: msg.dtmf?.digit, track: msg.dtmf?.track }, 'TwilioVoice stream: DTMF digit received');
            break;
          }

          case 'stop': {
            logger.info({ ip: clientIp }, 'TwilioVoice stream: stop event received, ending session');
            await tryCleanup();
            break;
          }

          default:
            break;
        }
      } catch (err) {
        logger.error({ error: err, ip: clientIp }, 'TwilioVoice stream: unhandled error processing message');
      }
    });

    logger.info({ ip: clientIp }, 'TwilioVoice stream: WebSocket connection accepted, awaiting start event');
  }

  /**
   * Handles a request to place an outgoing Twilio Voice call.
   *
   * Flow:
   * 1. Validate query params (apiKey, channelProviderId) and request body.
   * 2. Load channel provider config.
   * 3. Resolve the target stageId (body value or project default).
   * 4. Pre-create a conversation record with direction 'outgoing'.
   * 5. Place the outbound call via Twilio REST API using the webhook URL as the `url`
   *    parameter (or `applicationSid` if configured in the provider).
   * 6. Track callSid → conversationId for webhook correlation.
   * 7. Persist callSid into conversation metadata.
   * 8. Return 201 with callSid and conversationId.
   */
  private async handleOutgoingCall(req: Request, res: Response): Promise<void> {
    const queryResult = voiceQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Missing or invalid query parameters' });
      return;
    }
    const { apiKey: rawApiKey, channelProviderId } = queryResult.data;

    const apiKeyRecord = await db.query.apiKeys.findFirst({ where: eq(apiKeys.key, rawApiKey) });
    if (!apiKeyRecord || !apiKeyRecord.isActive) {
      res.status(401).json({ error: 'Invalid or inactive API key' });
      return;
    }
    const { projectId, keySettings } = apiKeyRecord;

    if (keySettings?.allowedChannels && !keySettings.allowedChannels.includes('twilio_voice')) {
      res.status(403).json({ error: 'API key does not permit twilio_voice channel' });
      return;
    }

    const bodyResult = twilioVoiceCallBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Invalid request body', issues: bodyResult.error.issues });
      return;
    }
    const body = bodyResult.data;

    const providerRecord = await db.query.providers.findFirst({ where: eq(providers.id, channelProviderId) });
    if (!providerRecord || providerRecord.providerType !== 'channel') {
      res.status(400).json({ error: 'Channel provider not found or wrong type' });
      return;
    }

    const rawConfig = await this.secretRefUtils.resolveObject(providerRecord.config as Record<string, unknown>);
    const configResult = twilioVoiceChannelProviderConfigSchema.safeParse(rawConfig);
    if (!configResult.success) {
      logger.error({ channelProviderId, issues: configResult.error.issues }, 'TwilioVoice outgoing: channel provider config is invalid');
      res.status(500).json({ error: 'Channel provider config is invalid' });
      return;
    }
    const config = configResult.data;

    // Resolve stageId: body overrides project default
    let resolvedStageId = body.stageId;
    if (!resolvedStageId) {
      const project = await this.projectService.getProjectById(projectId, SYSTEM_CONTEXT);
      resolvedStageId = project.startingStageId ?? undefined;
      if (!resolvedStageId) {
        res.status(422).json({ error: 'No stageId provided and project has no default starting stage' });
        return;
      }
    }

    // Ensure the user exists (create if not)
    await this.userService.ensureUserExists(projectId, body.to);

    // Deep-merge injected userProfile into existing user profile
    if (body.userProfile && Object.keys(body.userProfile).length > 0) {
      await this.userService.updateUserProfile(projectId, body.to, body.userProfile);
    }

    // Pre-create the conversation so we have a record regardless of whether the callee answers
    const sessionId = `session_${Math.random().toString(36).substr(2, 9)}`;
    const conversation = await this.conversationService.createConversation({
      projectId,
      userId: body.to,
      sessionId,
      stageId: resolvedStageId,
      status: 'initialized',
      direction: 'outgoing',
      metadata: body.metadata ?? null,
    }, SYSTEM_CONTEXT);

    // Place the outbound call via Twilio REST API
    // Build the webhook URL from the incoming request so Twilio can reach our handler when
    // the callee answers. applicationSid is used instead only when explicitly configured.
    const { apiKey: rawApiKeyForUrl, channelProviderId: channelProviderIdForUrl, stageId: stageIdForUrl, agentId: agentIdForUrl } = queryResult.data;
    const webhookParams = new URLSearchParams({ apiKey: rawApiKeyForUrl, channelProviderId: channelProviderIdForUrl });
    if (stageIdForUrl) webhookParams.set('stageId', stageIdForUrl);
    if (agentIdForUrl) webhookParams.set('agentId', agentIdForUrl);
    // Use req.hostname (respects X-Forwarded-Host set by Traefik/nginx) and
    // X-Forwarded-Port so the URL is publicly reachable, not an internal address.
    const forwardedPort = req.headers['x-forwarded-port'] as string | undefined;
    const defaultPort = req.protocol === 'https' ? '443' : '80';
    const port = forwardedPort ?? defaultPort;
    const isStandardPort = (req.protocol === 'https' && port === '443') || (req.protocol === 'http' && port === '80');
    const host = isStandardPort ? req.hostname : `${req.hostname}:${port}`;
    const webhookUrl = `${req.protocol}://${host}/api/twilio/voice/webhook?${webhookParams.toString()}`;
    const TwilioConstructor = _twilioModule.Twilio ?? _twilioModule;
    const twilioClient = new TwilioConstructor(config.accountSid, config.authToken);
    let callSid: string;
    try {
      const callCreateParams: Record<string, string> = { to: body.to, from: config.phoneNumber };
      if (config.applicationSid) {
        callCreateParams.applicationSid = config.applicationSid;
      } else {
        callCreateParams.url = webhookUrl;
      }
      const call = await twilioClient.calls.create(callCreateParams);
      callSid = call.sid;
    } catch (error) {
      logger.error({ error, projectId, to: body.to }, 'TwilioVoice: failed to create outbound call');
      try {
        await this.conversationService.failConversation(projectId, conversation.id, 'Failed to initiate outbound call');
      } catch { /* best effort */ }
      res.status(502).json({ error: 'Failed to initiate outbound call via Twilio' });
      return;
    }

    // Track callSid → conversationId so handleWebhook can pass it through to the stream
    this.pendingOutboundCalls.set(callSid, conversation.id);

    // Persist callSid into conversation metadata for traceability
    await this.conversationService.setConversationMetadata(projectId, conversation.id, { ...(body.metadata ?? {}), callSid });

    logger.info({ projectId, conversationId: conversation.id, callSid, to: body.to }, 'TwilioVoice: outbound call initiated');

    const response: TwilioVoiceCallResponse = { callSid, conversationId: conversation.id };
    res.status(201).json(response);
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
      send: (msg) => {
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

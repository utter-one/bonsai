import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { db } from '../../../db';
import { providers } from '../../../db/schema';
import { SecretRefUtils } from '../../secrets/SecretRefUtils';
import { telegramChannelProviderConfigSchema } from '../../providers/channel/TelegramChannelProvider';
import { twilioMessagingChannelProviderConfigSchema } from '../../providers/channel/TwilioMessagingChannelProvider';
import { whatsAppChannelProviderConfigSchema } from '../../providers/channel/WhatsAppChannelProvider';
import { getProviderCallRecorder } from '../ProviderCallRecorder';
import { logger } from '../../../utils/logger';
import type { AlertEvent } from '../AlertEventPublisher';
import { buildAlertText } from './alertMessage';
import type { AlertNotifier, AlertPhase, DeliveryResult } from './AlertNotifier';
import type { NotifierConfig } from '../../../http/contracts/monitoring';
import * as _twilio from 'twilio';

const _twilioModule = (_twilio as any).default ?? _twilio;
const TwilioClient = _twilioModule.Twilio as typeof import('twilio').Twilio;

/**
 * P4-02 (consolidated) — provider-row channel alert delivery: one notifier
 * for all three messaging channels (telegram / twilio_sms / whatsapp) instead
 * of three near-identical classes.
 *
 * No new credentials: `channelProviderId` points at a `providers` row
 * (`providerType='channel'`, apiType telegram | twilio_messaging |
 * whatsapp). Credentials are resolved through `SecretRefUtils` exactly like
 * the channel hosts, parsed with the hosts' exported schemas, and the send is
 * issued directly (Bot API / Twilio SDK / Graph API) because the channel
 * connections swallow errors and are gated on CAL message types (spec
 * finding 4).
 *
 * What the class owns (shared by all three channels): provider load +
 * validation, secret resolution, per-delivery timeout, the
 * `channel.send_message` call-log row (so a broken alert provider feeds
 * `provider-degraded` like normal traffic), error→DeliveryResult + pino.
 * What differs per channel is a small strategy table: accepted provider
 * apiType, text budget, recipient field, and the send itself.
 *
 * Channel notes (from the pre-consolidation notifiers):
 * - telegram: plain text, no `parse_mode` (event.message is free-form error
 *   text), 3900 chars (Bot API limit 4096). `chatId` = numeric user id,
 *   `@channel` handle or `-100…` supergroup id.
 * - twilio_sms: 320 chars (1 SMS segment); from-number comes from the
 *   provider row; Twilio trial accounts can only reach verified numbers
 *   (documented, not enforced).
 * - whatsapp: 4000 chars (Meta hard limit 4096 UTF-16 code units, headroom);
 *   business-initiated sends outside the 24 h customer-service window
 *   require a pre-approved Meta template (documented, not enforced — spec
 *   finding 9); `appSecret`/`verifyToken` are inbound-only and unused here.
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';
const GRAPH_API_BASE = 'https://graph.facebook.com/v17.0';
const DEFAULT_PER_DELIVERY_TIMEOUT_MS = 10_000;

export type ChannelType = 'telegram' | 'twilio_sms' | 'whatsapp';

type ProviderRow = typeof providers.$inferSelect;
type ProviderLoader = (
  providerId: string,
) => ProviderRow | undefined | Promise<ProviderRow | undefined>;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type MessagesCreateLike = (params: { body: string; from: string; to: string }) => Promise<unknown>;
type CallRecordEntry = {
  providerId: string;
  providerType: string;
  apiType: string;
  operation: string;
  durationMs: number;
  ok: boolean;
  error?: unknown;
  statusHttp?: number | null;
};
// NOTE: TS 6.0.3 does not contextually type arrow parameters when the
// contextual type is a named type — annotate `entry` explicitly everywhere
// a recorder callback is constructed inline.
type CallRecorderLike = { record(entry: CallRecordEntry): void };

/** Everything a channel send needs — transports are injected so tests stay hermetic. */
interface ChannelSendContext {
  resolvedConfig: Record<string, unknown>;
  recipient: string;
  text: string;
  providerId: string;
  fetch: FetchLike;
  /** null → real Twilio SDK `messages.create`. */
  messagesCreate: MessagesCreateLike | null;
  /**
   * Inline function type on purpose: TS 6.0.3 does not accept an inline
   * arrow when the contextual property type is a named alias (e.g.
   * `CallRecorderLike`) — the inlined spelling is assignable, the alias is not.
   */
  record: (entry: CallRecordEntry) => void;
}

interface ChannelStrategy {
  /** `providers.apiType` this strategy accepts (validated on load). */
  apiType: string;
  /** Human label for the timeout error, e.g. `sms delivery via …`. */
  label: string;
  /** Max chars for the rendered alert text. */
  textLimit: number;
  /** Which notifier-config field carries the recipient. */
  recipientField: 'chatId' | 'to';
  send(ctx: ChannelSendContext): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Measure the send and record exactly one `channel.send_message` row per
 * attempt. A timed-out in-flight send never reaches the record — same
 * abandoned-send semantics as the pre-consolidation notifiers (the failure
 * is still visible in `alert_events.notifications`).
 */
async function timedSend(
  ctx: ChannelSendContext,
  apiType: string,
  attempt: () => Promise<number | null>,
): Promise<void> {
  const startedAt = Date.now();
  try {
    const statusHttp = await attempt();
    ctx.record({
      providerId: ctx.providerId,
      providerType: 'channel',
      apiType,
      operation: 'channel.send_message',
      durationMs: Date.now() - startedAt,
      ok: true,
      statusHttp: statusHttp ?? null,
    });
  } catch (error) {
    ctx.record({
      providerId: ctx.providerId,
      providerType: 'channel',
      apiType,
      operation: 'channel.send_message',
      durationMs: Date.now() - startedAt,
      ok: false,
      error: error ?? undefined,
      statusHttp: (error as { status?: number }).status ?? null,
    });
    throw error;
  }
}

/** The per-channel differences — everything else is shared in the class. */
const STRATEGIES: Record<ChannelType, ChannelStrategy> = {
  telegram: {
    apiType: 'telegram',
    label: 'telegram',
    textLimit: 3900,
    recipientField: 'chatId',
    send: (ctx) =>
      timedSend(ctx, 'telegram', async () => {
        const cfg = telegramChannelProviderConfigSchema.parse(ctx.resolvedConfig);
        const response = await ctx.fetch(`${TELEGRAM_API_BASE}${cfg.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: ctx.recipient, text: ctx.text }),
        });
        if (!response.ok) {
          const error = new Error(`Telegram Bot API responded with ${response.status}: ${await response.text()}`) as Error & { status?: number };
          error.status = response.status;
          throw error;
        }
        return response.status;
      }),
  },
  twilio_sms: {
    apiType: 'twilio_messaging',
    label: 'sms',
    textLimit: 320,
    recipientField: 'to',
    send: (ctx) =>
      timedSend(ctx, 'twilio_messaging', async () => {
        const cfg = twilioMessagingChannelProviderConfigSchema.parse(ctx.resolvedConfig);
        const params = { body: ctx.text, from: cfg.fromNumber, to: ctx.recipient };
        if (ctx.messagesCreate) {
          await ctx.messagesCreate(params);
        } else {
          const client = new TwilioClient(cfg.accountSid, cfg.authToken);
          await client.messages.create(params);
        }
        return null;
      }),
  },
  whatsapp: {
    apiType: 'whatsapp',
    label: 'whatsapp',
    textLimit: 4000,
    recipientField: 'to',
    send: (ctx) =>
      timedSend(ctx, 'whatsapp', async () => {
        const cfg = whatsAppChannelProviderConfigSchema.parse(ctx.resolvedConfig);
        const response = await ctx.fetch(`${GRAPH_API_BASE}/${cfg.phoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.accessToken}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: ctx.recipient,
            type: 'text',
            text: { body: ctx.text },
          }),
        });
        if (!response.ok) {
          const error = new Error(`Graph API responded with ${response.status}: ${await response.text()}`) as Error & { status?: number };
          error.status = response.status;
          throw error;
        }
        return response.status;
      }),
  },
};

@singleton()
export class ChannelNotifier implements AlertNotifier {
  /** Serves telegram / twilio_sms / whatsapp (see STRATEGIES). */
  readonly type = 'channel' as const;

  private perDeliveryTimeoutMs = DEFAULT_PER_DELIVERY_TIMEOUT_MS;
  private fetchForTests: FetchLike | null = null;
  private messagesCreateForTests: MessagesCreateLike | null = null;
  private providerLoaderForTests: ProviderLoader | null = null;
  private callRecorderForTests: CallRecorderLike | null = null;

  constructor(
    @inject(SecretRefUtils) private readonly secretRefUtils: SecretRefUtils,
  ) {}

  /** Test seam — production keeps the 10 s per-delivery timeout. */
  setPerDeliveryTimeoutMsForTests(ms: number): void {
    this.perDeliveryTimeoutMs = ms;
  }

  /** Test seam — `null` restores real fetch (telegram + whatsapp sends). */
  setFetchForTests(fn: FetchLike | null): void {
    this.fetchForTests = fn;
  }

  /** Test seam — `null` restores the real Twilio `messages.create`. */
  setMessagesCreateForTests(fn: MessagesCreateLike | null): void {
    this.messagesCreateForTests = fn;
  }

  /** Test seam — `null` restores the real providers table read. */
  setProviderLoaderForTests(loader: ProviderLoader | null): void {
    this.providerLoaderForTests = loader;
  }

  /** Test seam — `null` restores the container call recorder. */
  setCallRecorderForTests(recorder: CallRecorderLike | null): void {
    this.callRecorderForTests = recorder;
  }

  async deliver(
    event: AlertEvent,
    phase: AlertPhase,
    config: NotifierConfig,
  ): Promise<DeliveryResult> {
    const strategy = STRATEGIES[config.type as ChannelType];
    if (!strategy) {
      return { ok: false, detail: `unsupported channel notifier type: ${config.type}` };
    }
    const recipient = strategy.recipientField === 'chatId' ? config.chatId : config.to;
    if (!config.channelProviderId || !recipient) {
      return { ok: false, detail: `${config.type} notifier missing channelProviderId/${strategy.recipientField} (config invalid)` };
    }
    try {
      const provider = await this.loadProvider(config.channelProviderId, strategy.apiType);
      const resolvedConfig = await this.secretRefUtils.resolveObject(provider.config as Record<string, unknown>);
      const text = buildAlertText(event, phase, strategy.textLimit);
      const recorder: CallRecorderLike = this.callRecorderForTests ?? getProviderCallRecorder();
      await this.withTimeout(
        strategy.send({
          resolvedConfig,
          recipient,
          text,
          providerId: provider.id,
          fetch: (url: string, init: RequestInit) => this.fetch(url, init),
          messagesCreate: this.messagesCreateForTests,
          record: (entry: CallRecordEntry) => recorder.record(entry),
        }),
        `${strategy.label} delivery via ${config.channelProviderId}`,
      );
      return { ok: true };
    } catch (error) {
      logger.error(
        { error: errorMessage(error), notifierId: config.id, alertId: event.id, providerId: config.channelProviderId, channelType: config.type },
        'ChannelNotifier: delivery failed',
      );
      return { ok: false, detail: errorMessage(error) };
    }
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  /**
   * Load + validate the channel provider row: must exist, be a channel
   * provider, and have the apiType the strategy expects.
   */
  private async loadProvider(providerId: string, expectedApiType: string): Promise<ProviderRow> {
    let provider: ProviderRow | undefined;
    if (this.providerLoaderForTests) {
      provider = await this.providerLoaderForTests(providerId);
    } else {
      const rows = await db.select().from(providers).where(eq(providers.id, providerId));
      provider = rows[0];
    }
    if (!provider) {
      throw new Error(`channel provider not found: ${providerId}`);
    }
    if (provider.providerType !== 'channel') {
      throw new Error(`provider ${providerId} is not a channel provider (type: ${provider.providerType})`);
    }
    if (provider.apiType !== expectedApiType) {
      throw new Error(`provider type mismatch: expected ${expectedApiType}, found ${provider.apiType}`);
    }
    return provider;
  }

  private fetch(url: string, init: RequestInit): Promise<Response> {
    return this.fetchForTests ? this.fetchForTests(url, init) : globalThis.fetch(url, init);
  }

  /** Bounded await (abandon on timeout — same semantics as EmailNotifier). */
  private async withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${label} timed out after ${this.perDeliveryTimeoutMs} ms`)),
            this.perDeliveryTimeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

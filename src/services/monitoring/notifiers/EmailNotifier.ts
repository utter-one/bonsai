import 'reflect-metadata';
import { injectable, inject } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { db } from '../../../db';
import { providers } from '../../../db/schema';
import { SecretRefUtils } from '../../secrets/SecretRefUtils';
import { SessionManager } from '../../../channels/SessionManager';
import {
  EmailConnectionBase,
  type ThreadingStrategy,
} from '../../../channels/email/shared/EmailConnectionBase';
import { SendGridConnection } from '../../../channels/email/sendgrid/SendGridConnection';
import { SesConnection } from '../../../channels/email/ses/SesConnection';
import { SmtpImapConnection } from '../../../channels/email/smtp-imap/SmtpImapConnection';
import { sendGridChannelProviderConfigSchema } from '../../providers/channel/SendGridChannelProvider';
import { sesChannelProviderConfigSchema } from '../../providers/channel/SesChannelProvider';
import { smtpImapChannelProviderConfigSchema } from '../../providers/channel/SmtpImapChannelProvider';
import { logger } from '../../../utils/logger';
import type { AlertEvent } from '../AlertEventPublisher';
import type { AlertPhase, DeliveryResult } from './AlertNotifier';
import type { NotifierConfig } from '../../../http/contracts/monitoring';

/**
 * P2-02 — email alert delivery via an existing channel provider (finding 4/5).
 *
 * No new credentials: the `channelProviderId` points at a `providers` row
 * (`providerType='channel'`, apiType sendgrid | ses | smtp_imap). Config is
 * resolved through `SecretRefUtils` exactly like the channel hosts, parsed
 * with the hosts' exported schemas, and a connection is instantiated per
 * delivery (they're lightweight; the SMTP connection self-refreshes its
 * OAuth2 token from the providers row on send).
 *
 * Deliberately bypasses the channel host's conversation machinery — this is a
 * raw email send, not a conversation. The connection's P1-03 wrapper records
 * a `channel.send_message` call-log row per delivery (finding 3), so broken
 * alert-mail providers feed `provider-degraded`.
 */

const DEFAULT_PER_DELIVERY_TIMEOUT_MS = 10_000;
const CONTEXT_JSON_MAX_CHARS = 2000;

type ProviderRow = typeof providers.$inferSelect;

/**
 * Test seams (finding 8): `providerLoader` replaces the providers table read
 * (unit tests have no DB); `connectionBuilder` replaces per-delivery
 * connection construction (both unit and e2e — the send itself must not
 * hit the network).
 */
export type EmailProviderLoader = (
  providerId: string,
) => ProviderRow | undefined | Promise<ProviderRow | undefined>;

export type EmailConnectionBuilder = (
  provider: ProviderRow,
  resolvedConfig: Record<string, unknown>,
  to: string,
  subject: string,
) => EmailConnectionBase | Promise<EmailConnectionBase>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@injectable()
export class EmailNotifier {
  readonly type = 'email' as const;

  private perDeliveryTimeoutMs = DEFAULT_PER_DELIVERY_TIMEOUT_MS;
  private connectionBuilderForTests: EmailConnectionBuilder | null = null;
  private providerLoaderForTests: EmailProviderLoader | null = null;

  constructor(
    @inject(SecretRefUtils) private readonly secretRefUtils: SecretRefUtils,
    @inject(SessionManager) private readonly sessionManager: SessionManager,
  ) {}

  /** Test seam — production keeps the 10 s per-delivery timeout. */
  setPerDeliveryTimeoutMsForTests(ms: number): void {
    this.perDeliveryTimeoutMs = ms;
  }

  /** Test seam (finding 8) — `null` restores real per-delivery construction. */
  setConnectionBuilderForTests(builder: EmailConnectionBuilder | null): void {
    this.connectionBuilderForTests = builder;
  }

  /** Test seam — `null` restores the real providers table read. */
  setProviderLoaderForTests(loader: EmailProviderLoader | null): void {
    this.providerLoaderForTests = loader;
  }

  async deliver(
    event: AlertEvent,
    phase: AlertPhase,
    config: NotifierConfig,
  ): Promise<DeliveryResult> {
    if (!config.to || !config.channelProviderId) {
      return { ok: false, detail: 'email notifier missing to/channelProviderId (config invalid)' };
    }
    const subject = `[Bonsai][${event.severity.toUpperCase()}] ${event.ruleId} — ${event.scopeKey}`;
    try {
      const connection = await this.buildConnection(config.channelProviderId, config.to, subject);
      await this.withTimeout(
        connection.sendEmail(config.to, subject, this.buildBody(event, phase), []),
        `email delivery via ${config.channelProviderId}`,
      );
      return { ok: true };
    } catch (error) {
      logger.error(
        { error: errorMessage(error), notifierId: config.id, alertId: event.id, providerId: config.channelProviderId },
        'EmailNotifier: delivery failed',
      );
      return { ok: false, detail: errorMessage(error) };
    }
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  /**
   * Load the channel provider row, resolve its secret refs (same path as the
   * channel hosts), and construct a per-delivery connection.
   */
  private async buildConnection(
    providerId: string,
    to: string,
    subject: string,
  ): Promise<EmailConnectionBase> {
    const provider = await this.loadProvider(providerId);
    const resolvedConfig = await this.secretRefUtils.resolveObject(provider.config as Record<string, unknown>);

    const threadingStrategy = (resolvedConfig.threadingStrategy as ThreadingStrategy) ?? 'messageId';
    // The test seam replaces construction AFTER schema validation, so invalid
    // configs still fail exactly like production (and unknown apiTypes never
    // reach the seam).
    switch (provider.apiType) {
      case 'sendgrid': {
        const cfg = sendGridChannelProviderConfigSchema.parse(resolvedConfig);
        if (this.connectionBuilderForTests) {
          return this.connectionBuilderForTests(provider, resolvedConfig, to, subject);
        }
        return new SendGridConnection(to, cfg.fromAddress, threadingStrategy, this.sessionManager, subject, cfg.apiKey, undefined, undefined, provider.id);
      }
      case 'ses': {
        const cfg = sesChannelProviderConfigSchema.parse(resolvedConfig);
        if (this.connectionBuilderForTests) {
          return this.connectionBuilderForTests(provider, resolvedConfig, to, subject);
        }
        return new SesConnection(to, cfg.fromAddress, threadingStrategy, this.sessionManager, subject, cfg.accessKeyId, cfg.secretAccessKey, cfg.region, undefined, undefined, provider.id);
      }
      case 'smtp_imap': {
        const cfg = smtpImapChannelProviderConfigSchema.parse(resolvedConfig);
        if (this.connectionBuilderForTests) {
          return this.connectionBuilderForTests(provider, resolvedConfig, to, subject);
        }
        return new SmtpImapConnection(
          to, cfg.fromAddress, threadingStrategy, this.sessionManager, subject, provider.id,
          cfg.smtp.host, cfg.smtp.port, cfg.smtp.secure, cfg.smtp.auth.user, cfg.smtp.auth.pass,
          undefined, undefined,
        );
      }
      default:
        throw new Error(`unsupported channel provider apiType for email alerts: ${provider.apiType}`);
    }
  }

  /**
   * Load + validate the channel provider row. The test loader seam replaces
   * only the table read so unit tests can exercise the validation, schema
   * parse and construction paths without a database.
   */
  private async loadProvider(providerId: string): Promise<ProviderRow> {
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
    return provider;
  }

  /**
   * Bounded await. The underlying transporter has no abort API, so on timeout
   * the in-flight send is abandoned (it may still complete in the background)
   * and the delivery is recorded as failed (finding 6).
   */
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

  /** Plain-text body: message + context summary (truncated) + timestamps (finding 12). */
  private buildBody(event: AlertEvent, phase: AlertPhase): string {
    const lines = [
      `Bonsai alert ${phase === 'fired' ? 'fired' : 'resolved'}`,
      '',
      event.message,
      '',
      `Rule: ${event.ruleId}`,
      `Severity: ${event.severity}`,
      `Scope: ${event.scopeKey}`,
      `Fired at: ${event.firedAt.toISOString()}`,
    ];
    if (event.resolvedAt) {
      lines.push(`Resolved at: ${event.resolvedAt.toISOString()}`);
    }
    lines.push('', 'Context:');
    let contextJson: string;
    try {
      contextJson = JSON.stringify(event.context, null, 2);
    } catch {
      contextJson = String(event.context);
    }
    if (contextJson === undefined || contextJson.length > CONTEXT_JSON_MAX_CHARS) {
      contextJson = `${(contextJson ?? '{}').slice(0, CONTEXT_JSON_MAX_CHARS)}\n…(truncated)`;
    }
    lines.push(contextJson);
    return lines.join('\n');
  }
}

import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { db } from '../../../db';
import { alertEvents, type AlertNotification } from '../../../db/schema';
import { logger } from '../../../utils/logger';
import type { AlertEvent, AlertEventPublisher } from '../AlertEventPublisher';
import { LogAndPersistPublisher } from '../AlertEventPublisher';
import { MonitoringConfigService } from '../MonitoringConfigService';
import type { NotifierConfig } from '../../../http/contracts/monitoring';
import { WebhookNotifier } from './WebhookNotifier';
import { EmailNotifier } from './EmailNotifier';
import { ChannelNotifier } from './ChannelNotifier';

/**
 * P2-02 — alert notifiers (spec + soundness review findings in
 * .issues/proposal/monitoring/P2-02-notifiers.md).
 *
 * `NotifyingPublisher` is the active `ALERT_EVENT_PUBLISHER_TOKEN`
 * implementation: it persists exactly like P2-01's `LogAndPersistPublisher`,
 * then fans out to the enabled notifiers from the monitoring config —
 * resolved **on every delivery** so `PUT /config` takes effect without a
 * restart (MonitoringConfigService is a shared @singleton since P2-02).
 *
 * Never throws, never blocks the engine (the engine invokes fire/resolve
 * fire-and-forget). Notifier failures become pino errors + recorded delivery
 * results, so alert history is complete even if every notifier is down.
 */

export type AlertPhase = 'fired' | 'resolved';

export type DeliveryResult = { ok: boolean; detail?: string };

export interface AlertNotifier {
  /**
   * Notifier type (matches `MonitoringConfig['notifiers'][n].type`).
   * `'channel'` is the consolidated provider-row notifier serving
   * telegram / twilio_sms / whatsapp (see ChannelNotifier).
   */
  readonly type: 'webhook' | 'email' | 'telegram' | 'twilio_sms' | 'whatsapp' | 'channel';
  deliver(event: AlertEvent, phase: AlertPhase, config: NotifierConfig): Promise<DeliveryResult>;
}

/** Severity floor ordering (finding 11) — deliver when event ≥ notifier floor. */
const SEVERITY_RANK: Record<string, number> = { info: 0, warning: 1, critical: 2 };

/** Publisher-wide cap for the whole parallel fan-out (finding 6). */
const DEFAULT_PUBLISHER_CAP_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

@singleton()
export class NotifyingPublisher implements AlertEventPublisher {
  private capMs = DEFAULT_PUBLISHER_CAP_MS;

  constructor(
    @inject(LogAndPersistPublisher) private readonly persister: LogAndPersistPublisher,
    @inject(MonitoringConfigService) private readonly configService: MonitoringConfigService,
    @inject(WebhookNotifier) public readonly webhookNotifier: WebhookNotifier,
    @inject(EmailNotifier) public readonly emailNotifier: EmailNotifier,
    @inject(ChannelNotifier) public readonly channelNotifier: ChannelNotifier,
  ) {}

  /** Test seam — production keeps the 15 s cap. */
  setPublisherCapMsForTests(ms: number): void {
    this.capMs = ms;
  }

  async fire(event: AlertEvent): Promise<void> {
    await this.persister.fire(event);
    await this.notify(event, 'fired');
  }

  async resolve(event: AlertEvent): Promise<number> {
    // A deleted/unknown row transitions nothing — a 'resolved' notification
    // for it would be a phantom (the operator removed the alert on purpose).
    const updated = await this.persister.resolve(event);
    if (updated > 0) {
      await this.notify(event, 'resolved');
    }
    return updated;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private async notify(event: AlertEvent, phase: AlertPhase): Promise<void> {
    let results: AlertNotification[];
    try {
      const config = await this.configService.get();
      const eligible = config.notifiers.filter(
        (n) => n.enabled && SEVERITY_RANK[event.severity] >= SEVERITY_RANK[n.minSeverity ?? 'info'],
      );
      if (eligible.length === 0) return;
      results = await this.fanOut(event, phase, eligible);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), alertId: event.id, phase },
        'NotifyingPublisher: notifier fan-out failed',
      );
      return;
    }
    try {
      await this.appendResults(event.id, results);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), alertId: event.id, phase },
        'NotifyingPublisher: failed to persist notification results',
      );
    }
  }

  /**
   * Route a notifier config to its implementation (P4-02: telegram /
   * twilio_sms / whatsapp all go to the shared ChannelNotifier's strategy
   * table — one class instead of three near-identical ones).
   */
  private notifierFor(config: NotifierConfig): AlertNotifier {
    switch (config.type) {
      case 'webhook':
        return this.webhookNotifier;
      case 'email':
        return this.emailNotifier;
      case 'telegram':
      case 'twilio_sms':
      case 'whatsapp':
        return this.channelNotifier;
    }
  }

  /**
   * Parallel fan-out with a publisher-wide cap (finding 6): each notifier
   * self-bounds (10 s per attempt; webhooks retry once on transport failure),
   * and the whole fan-out is raced against the 15 s cap. On overrun the
   * not-yet-complete notifiers are recorded as failed so `notifications`
   * always reflects actual attempts.
   */
  private async fanOut(
    event: AlertEvent,
    phase: AlertPhase,
    notifiers: NotifierConfig[],
  ): Promise<AlertNotification[]> {
    const results: AlertNotification[] = [];
    const done = new Set<string>();

    const perNotifier = notifiers.map((config) => {
      return this.notifierFor(config)
        .deliver(event, phase, config)
        .then(
          (result) => {
            results.push({
              notifierId: config.id,
              phase,
              ok: result.ok,
              ...(result.detail ? { detail: result.detail } : {}),
              at: new Date().toISOString(),
            });
            done.add(config.id);
          },
          (error: unknown) => {
            // deliver() never throws by contract — belt and braces (P2-01 finding 18).
            logger.error(
              { error: error instanceof Error ? error.message : String(error), notifierId: config.id, alertId: event.id, phase },
              'NotifyingPublisher: notifier threw despite never-throw contract',
            );
            results.push({
              notifierId: config.id,
              phase,
              ok: false,
              detail: `unexpected error: ${error instanceof Error ? error.message : String(error)}`,
              at: new Date().toISOString(),
            });
            done.add(config.id);
          },
        );
    });

    const incomplete: string[] = [];
    await Promise.race([
      Promise.all(perNotifier),
      sleep(this.capMs).then(() => {
        incomplete.push(...notifiers.map((n) => n.id).filter((id) => !done.has(id)));
        logger.warn(
          { alertId: event.id, phase, capMs: this.capMs, incompleteNotifiers: incomplete },
          'NotifyingPublisher: publisher cap exceeded — recording incomplete deliveries',
        );
      }),
    ]);

    for (const config of notifiers) {
      if (!done.has(config.id)) {
        results.push({
          notifierId: config.id,
          phase,
          ok: false,
          detail: 'incomplete: 15s publisher cap',
          at: new Date().toISOString(),
        });
      }
    }
    // Snapshot — late-arriving in-flight deliveries (abandoned by the cap)
    // may still push into `results` after we return; they are not persisted.
    return [...results];
  }

  /**
   * Append delivery results to the alert row (finding 10). Read-modify-write
   * by alert id; fire/resolve for the same row never overlap (engine passes
   * are sequential).
   */
  protected async appendResults(alertId: string, results: AlertNotification[]): Promise<void> {
    if (results.length === 0) return;
    const rows = await db.select().from(alertEvents).where(eq(alertEvents.id, alertId));
    if (rows.length === 0) {
      logger.warn({ alertId }, 'NotifyingPublisher: alert row missing — dropping notification results');
      return;
    }
    const existing = rows[0].notifications ?? [];
    await db
      .update(alertEvents)
      .set({ notifications: [...existing, ...results] })
      .where(eq(alertEvents.id, alertId));
  }
}

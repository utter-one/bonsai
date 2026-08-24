import 'reflect-metadata';
import { injectable } from 'tsyringe';
import { logger } from '../../../utils/logger';
import type { AlertEvent } from '../AlertEventPublisher';
import type { AlertPhase, DeliveryResult } from './AlertNotifier';
import type { NotifierConfig } from '../../../http/contracts/monitoring';

/**
 * P2-02 — webhook alert delivery.
 *
 * POSTs the documented JSON payload to the configured URL. Success = 2xx.
 * One retry on *transport* failure only (connection refused / DNS / timeout);
 * an HTTP response (even 5xx) is final — it is recorded, not retried.
 *
 * The URL may carry a token — it is never logged (finding 9): pino lines
 * include `notifierId` + status/detail only.
 */

const DEFAULT_PER_ATTEMPT_TIMEOUT_MS = 10_000;
const USER_AGENT = 'bonsai-backend-monitoring/1.0';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@injectable()
export class WebhookNotifier {
  readonly type = 'webhook' as const;

  private perAttemptTimeoutMs = DEFAULT_PER_ATTEMPT_TIMEOUT_MS;

  /** Test seam — production keeps the 10 s per-attempt timeout. */
  setPerAttemptTimeoutMsForTests(ms: number): void {
    this.perAttemptTimeoutMs = ms;
  }

  async deliver(
    event: AlertEvent,
    phase: AlertPhase,
    config: NotifierConfig,
  ): Promise<DeliveryResult> {
    if (!config.url) {
      return { ok: false, detail: 'webhook notifier missing url (config invalid)' };
    }
    const payload = {
      event: phase === 'fired' ? 'alert_fired' : 'alert_resolved',
      ruleId: event.ruleId,
      severity: event.severity,
      scopeKey: event.scopeKey,
      scope: event.scope,
      message: event.message,
      context: event.context,
      firedAt: event.firedAt.toISOString(),
      resolvedAt: event.resolvedAt ? event.resolvedAt.toISOString() : undefined,
    };

    for (let attempt = 1; attempt <= 2; attempt++) {
      let response: Response;
      try {
        response = await fetch(config.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.perAttemptTimeoutMs),
        });
      } catch (error) {
        const detail = `transport error: ${errorMessage(error)}`;
        if (attempt === 2) {
          logger.error(
            { notifierId: config.id, alertId: event.id, phase, attempt, error: errorMessage(error) },
            'WebhookNotifier: delivery failed after retry',
          );
          return { ok: false, detail };
        }
        logger.warn(
          { notifierId: config.id, alertId: event.id, phase, attempt, error: errorMessage(error) },
          'WebhookNotifier: transport failure, retrying once',
        );
        continue;
      }

      // An HTTP response is final — no retry on non-2xx.
      if (response.ok) {
        response.body?.cancel();
        return { ok: true };
      }
      response.body?.cancel();
      return { ok: false, detail: `HTTP ${response.status}` };
    }

    // Unreachable — the loop always returns.
    return { ok: false, detail: 'transport error: unexpected' };
  }
}

import 'reflect-metadata';
import { singleton, type InjectionToken } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { alertEvents } from '../../db/schema';
import { logger } from '../../utils/logger';

/**
 * Alert event + publisher seam (P2-01 finding 10).
 *
 * The engine fires/resolves through this interface and never touches
 * `alert_events` itself. P2-01 registers `LogAndPersistPublisher`; P2-02
 * swaps the token registration for a notifying wrapper without touching the
 * engine.
 */

export type AlertEvent = {
  id: string;
  ruleId: string;
  /** Full key: `ruleId:scopePart` (e.g. `provider-down:prov_123`, `api-429-spike:global`). */
  scopeKey: string;
  scope: Record<string, unknown>;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  context: Record<string, unknown>;
  firedAt: Date;
  resolvedAt?: Date;
};

/**
 * Contract: implementations must NEVER throw (every call is wrapped in
 * try/catch) and must cap their own latency (P2-02: 15 s per notification).
 * The engine invokes them fire-and-forget with a defensive `.catch` anyway.
 *
 * `resolve` returns the number of rows transitioned (0 = the row was deleted
 * or unknown) so wrappers can skip notifications for phantom resolutions.
 */
export interface AlertEventPublisher {
  fire(event: AlertEvent): Promise<void>;
  resolve(event: AlertEvent): Promise<number>;
}

/** DI token — registered against `LogAndPersistPublisher` in server.ts. */
export const ALERT_EVENT_PUBLISHER_TOKEN: InjectionToken<AlertEventPublisher> = 'AlertEventPublisher';

/** P2-01 publisher: persist the alert row + log it at the severity's level. */
@singleton()
export class LogAndPersistPublisher implements AlertEventPublisher {
  async fire(event: AlertEvent): Promise<void> {
    try {
      await db.insert(alertEvents)
        .values({
          id: event.id,
          ruleId: event.ruleId,
          scopeKey: event.scopeKey,
          scope: event.scope,
          severity: event.severity,
          status: 'firing',
          message: event.message,
          context: event.context,
          notifications: [],
          firedAt: event.firedAt,
        });
      this.log(event, 'ALERT FIRING');
    } catch (error) {
      logger.error({ error, alertId: event.id, scopeKey: event.scopeKey }, 'LogAndPersistPublisher.fire failed');
    }
  }

  /** @returns the number of rows transitioned (0 = deleted/unknown id — callers must not notify). */
  async resolve(event: AlertEvent): Promise<number> {
    try {
      const result = await db.update(alertEvents)
        .set({
          status: 'resolved',
          resolvedAt: event.resolvedAt ?? new Date(),
          // The engine always sends the full context plus `resolutionReason`
          // (finding 12) — persist both so the P2-03 query API can show why.
          context: event.context,
        })
        .where(eq(alertEvents.id, event.id));
      if ((result.rowCount ?? 0) === 0) {
        logger.warn({ alertId: event.id }, 'LogAndPersistPublisher.resolve: no firing row to resolve (already resolved or purged)');
        return 0;
      }
      this.log(event, 'ALERT RESOLVED');
      return result.rowCount;
    } catch (error) {
      logger.error({ error, alertId: event.id, scopeKey: event.scopeKey }, 'LogAndPersistPublisher.resolve failed');
      return 0;
    }
  }

  private log(event: AlertEvent, label: string): void {
    const line = `${label} [${event.scopeKey}] ${event.message}`;
    switch (event.severity) {
      case 'critical':
        logger.error({ alertId: event.id, scopeKey: event.scopeKey, ruleId: event.ruleId }, line);
        break;
      case 'warning':
        logger.warn({ alertId: event.id, scopeKey: event.scopeKey, ruleId: event.ruleId }, line);
        break;
      default:
        logger.info({ alertId: event.id, scopeKey: event.scopeKey, ruleId: event.ruleId }, line);
        break;
    }
  }
}

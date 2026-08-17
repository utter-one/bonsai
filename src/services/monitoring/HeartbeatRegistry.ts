import { inject, singleton } from 'tsyringe';
import logger from '../../utils/logger';
import { MetricsRegistry } from './MetricsRegistry';

/**
 * In-memory heartbeats for the six background services (PROPOSAL §3.2d).
 *
 * Each service calls `tick('<name>')` at loop start (one-line change per
 * service) and `recordError('<name>')` in its existing catch blocks.
 * `staleServices(maxAgeMs)` powers the `service_heartbeat:{name}` health check
 * (P1-05); `tick()` also publishes the `background_service_last_run_ts{service}`
 * gauge so the rule engine reads it like any other metric.
 */
@singleton()
export class HeartbeatRegistry {
  private lastRunTimes = new Map<string, number>();
  private errorCounts = new Map<string, number>();

  constructor(@inject(MetricsRegistry) private readonly metricsRegistry: MetricsRegistry) {}

  /** Records a successful loop run and publishes the heartbeat gauge. Never throws. */
  tick(service: string): void {
    try {
      const now = Date.now();
      this.lastRunTimes.set(service, now);
      this.metricsRegistry.setGauge('background_service_last_run_ts', { service }, now);
    } catch (err) {
      logger.error({ error: (err as Error)?.message ?? String(err), service }, 'HeartbeatRegistry.tick failed');
    }
  }

  /** Epoch ms of the last successful run, or undefined if the service never ticked. */
  lastRun(service: string): number | undefined {
    return this.lastRunTimes.get(service);
  }

  /** Records a caught failure in a service loop. */
  recordError(service: string): void {
    this.errorCounts.set(service, (this.errorCounts.get(service) ?? 0) + 1);
  }

  /** Cumulative error count since process start. */
  errorCount(service: string): number {
    return this.errorCounts.get(service) ?? 0;
  }

  /** Services whose last successful run is older than `maxAgeMs` (or never ran is NOT included). */
  staleServices(maxAgeMs: number, now: number = Date.now()): string[] {
    const stale: string[] = [];
    for (const [service, last] of this.lastRunTimes) {
      if (now - last > maxAgeMs) stale.push(service);
    }
    return stale.sort();
  }
}

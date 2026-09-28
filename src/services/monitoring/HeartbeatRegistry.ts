import { inject, singleton } from 'tsyringe';
import logger from '../../utils/logger';
import { MetricsRegistry } from './MetricsRegistry';

/** Fallback staleness threshold for services that tick without declaring an interval. */
const DEFAULT_DECLARED_INTERVAL_MS = 60_000;

/** P1-05: per-service heartbeat state for the `service_heartbeat:{name}` health check. */
export interface ServiceHeartbeatState {
  lastRun: number;
  ageMs: number;
  declaredIntervalMs: number;
  thresholdMs: number; // 3 × declaredIntervalMs
  stale: boolean;
  errorCount: number;
}

/**
 * In-memory heartbeats for the background services (PROPOSAL §3.2d).
 *
 * Each service calls `tick('<name>', intervalMs?)` at loop start (one-line change per
 * service) and `recordError('<name>')` in its loop-level catch blocks.
 * `serviceStates(now)` powers the per-service 3× staleness health check (P1-05);
 * `staleServices(maxAgeMs)` (P1-02) keeps working for single-threshold callers.
 * `tick()` also publishes the `background_service_last_run_ts{service}`
 * gauge so the rule engine reads it like any other metric.
 */
@singleton()
export class HeartbeatRegistry {
  private lastRunTimes = new Map<string, number>();
  private declaredIntervals = new Map<string, number>();
  private errorCounts = new Map<string, number>();

  constructor(@inject(MetricsRegistry) private readonly metricsRegistry: MetricsRegistry) {}

  /**
   * Records a successful loop run and publishes the heartbeat gauge. Never throws.
   * `intervalMs` optionally (re-)declares the service's effective interval for
   * per-service 3× staleness thresholds.
   */
  tick(service: string, intervalMs?: number): void {
    try {
      const now = Date.now();
      this.lastRunTimes.set(service, now);
      if (intervalMs !== undefined && intervalMs > 0) this.declaredIntervals.set(service, intervalMs);
      this.metricsRegistry.setGauge('background_service_last_run_ts', { service }, now);
    } catch (err) {
      logger.error({ error: (err as Error)?.message ?? String(err), service }, 'HeartbeatRegistry.tick failed');
    }
  }

  /** Declares the service's effective interval without recording a run (e.g. min of per-provider IMAP session intervals). */
  declareInterval(service: string, intervalMs: number): void {
    if (intervalMs > 0) this.declaredIntervals.set(service, intervalMs);
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

  /**
   * P1-05: per-service state for the `service_heartbeat:{name}` health check.
   * Services that never ticked are excluded (the check reports `unknown` for them —
   * no work is not a failure). Threshold = 3× the declared interval
   * (default 60 s when undeclared).
   */
  serviceStates(now: number = Date.now()): Record<string, ServiceHeartbeatState> {
    const states: Record<string, ServiceHeartbeatState> = {};
    for (const [service, last] of this.lastRunTimes) {
      const declaredIntervalMs = this.declaredIntervals.get(service) ?? DEFAULT_DECLARED_INTERVAL_MS;
      const ageMs = Math.max(0, now - last);
      const thresholdMs = 3 * declaredIntervalMs;
      states[service] = {
        lastRun: last,
        ageMs,
        declaredIntervalMs,
        thresholdMs,
        stale: ageMs > thresholdMs,
        errorCount: this.errorCounts.get(service) ?? 0,
      };
    }
    return states;
  }
}

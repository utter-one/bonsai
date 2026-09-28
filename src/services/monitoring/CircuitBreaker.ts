import { CircuitOpenError } from '../../errors';
import type { MetricsRegistry } from './MetricsRegistry';

/**
 * P3-01 — per-provider circuit breaker (PROPOSAL §3.4).
 *
 * State machine:
 * ```
 * closed  → open       (≥ failureThreshold qualifying failures within windowMs)
 * open    → half-open  (cooldownMs elapsed — at most one probe allowed)
 * half-open → closed   (probe succeeds)
 * half-open → open     (probe fails; cooldown restarts)
 * ```
 *
 * Fed exclusively by `CallLogger.record()` outcomes via `CircuitBreakerRegistry`
 * (zero new call sites — P1-03 already records every third-party call).
 * `beforeCall()` is the gate that the P3-03/P3-04 failover wrappers call before
 * a provider attempt; business code never calls it (advisory until then).
 *
 * Pure in-process state — a restart resets every breaker to closed. The
 * `provider-down` alert rule (P2-01, windowed on provider_call_logs) + health
 * probes cover the restart gap; the call logs remain the source of truth.
 *
 * Counting rules: `server_error`, `timeout`, `network`, `rate_limited` and
 * `unknown` count; `auth` (won't self-heal — the provider-auth-failed rule
 * handles it, P3-06) and `client_error` (bad payload, provider is fine) never
 * count. Successes do NOT clear the failure window (the threshold is a
 * failures-only sliding window). Results arriving while open (in-flight calls
 * that started before the open) are ignored — they do not extend the cooldown.
 */

export type BreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerParams {
  /** Qualifying failures within `windowMs` that open the breaker. */
  failureThreshold: number;
  /** Sliding window for counting failures (ms). */
  windowMs: number;
  /** open → half-open cooldown (ms). */
  cooldownMs: number;
}

export const DEFAULT_CIRCUIT_BREAKER_PARAMS: CircuitBreakerParams = {
  failureThreshold: 5,
  windowMs: 60_000,
  cooldownMs: 5 * 60_000,
};

/** Error codes that never open the breaker (everything else counts, incl. 'unknown'). */
export const NON_COUNTING_ERROR_CODES = new Set<string>(['auth', 'client_error']);

const STATE_VALUES: Record<BreakerState, number> = { closed: 0, open: 1, 'half-open': 2 };
const OPENS_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface BreakerSnapshot {
  state: BreakerState;
  failuresInWindow: number;
  lastStateChangeAt: Date;
  opensInLast24h: number;
}

/**
 * The breaker itself. `paramsProvider` is evaluated on every check so
 * `monitoring_config` overrides take effect live (no restart needed).
 */
export class CircuitBreaker {
  private state: BreakerState = 'closed';
  /** Timestamps of qualifying failures (pruned to the window on record). */
  private failures: number[] = [];
  private openedAt: number | null = null;
  private lastStateChangeAt = Date.now();
  private opensTimestamps: number[] = [];

  constructor(
    readonly providerId: string,
    private readonly paramsProvider: () => CircuitBreakerParams,
    private readonly metrics: MetricsRegistry,
  ) {
    // Explicit 'closed' series at creation — every provider that logs calls
    // shows circuit_breaker_state=0 until it trips (bounded: one series per provider).
    this.metrics.setGauge('circuit_breaker_state', { provider_id: this.providerId }, STATE_VALUES.closed);
  }

  get currentState(): BreakerState {
    return this.state;
  }

  /**
   * Gate for failover wrappers (P3-03/P3-04). Throws `CircuitOpenError` while
   * the breaker is open and the cooldown has not elapsed, and while half-open
   * (the single probe is in flight — concurrent calls are treated as open).
   * When the cooldown has elapsed, allows exactly one probe and moves to
   * half-open. The probe's own logged result (P1-03 records every path) moves
   * the breaker to closed (success) or open (failure).
   */
  beforeCall(): void {
    if (this.state === 'half-open') {
      // A probe is in flight (half-open ⟺ probe in flight: the only way into
      // half-open is beforeCall(), the only ways out are the probe's result).
      this.metrics.inc('circuit_open_skips_total', { provider_id: this.providerId });
      throw new CircuitOpenError(this.providerId);
    }
    if (this.state !== 'open') return; // closed — allow
    const params = this.paramsProvider();
    if (this.openedAt !== null && Date.now() - this.openedAt < params.cooldownMs) {
      this.metrics.inc('circuit_open_skips_total', { provider_id: this.providerId });
      throw new CircuitOpenError(this.providerId);
    }
    this.setState('half-open');
  }

  /** A logged success for this provider. */
  recordSuccess(): void {
    if (this.state === 'half-open') {
      // The probe succeeded → close and reset.
      this.failures = [];
      this.setState('closed');
      return;
    }
    // Success while open (in-flight from before the open): ignored — the
    // cooldown runs out on its own. Success while closed: no window reset by design.
  }

  /** A logged failure for this provider. `errorCode` null → 'unknown' (counts, conservatively). */
  recordFailure(errorCode: string | null | undefined): void {
    const code = errorCode || 'unknown';
    const now = Date.now();
    if (this.state === 'half-open') {
      // The probe failed → reopen; the cooldown restarts from now.
      this.failures = [now];
      this.open();
      return;
    }
    if (this.state === 'open') {
      // In-flight failure from before the open: ignored — no cooldown extension.
      return;
    }
    if (NON_COUNTING_ERROR_CODES.has(code)) return;
    const params = this.paramsProvider();
    this.failures.push(now);
    const cutoff = now - params.windowMs;
    while (this.failures.length > 0 && this.failures[0] < cutoff) this.failures.shift();
    if (this.failures.length >= params.failureThreshold) this.open();
  }

  snapshot(): BreakerSnapshot {
    const now = Date.now();
    const windowMs = this.paramsProvider().windowMs;
    return {
      state: this.state,
      failuresInWindow: this.failures.filter((t) => now - t < windowMs).length,
      lastStateChangeAt: new Date(this.lastStateChangeAt),
      opensInLast24h: this.opensTimestamps.filter((t) => now - t < OPENS_RETENTION_MS).length,
    };
  }

  // --- internals ---

  private open(): void {
    const now = Date.now();
    this.setState('open');
    this.openedAt = now;
    this.opensTimestamps.push(now);
    const cutoff = now - OPENS_RETENTION_MS;
    this.opensTimestamps = this.opensTimestamps.filter((t) => t >= cutoff);
    this.metrics.inc('circuit_opens_total', { provider_id: this.providerId });
  }

  private setState(next: BreakerState): void {
    if (this.state === next) return;
    this.state = next;
    this.lastStateChangeAt = Date.now();
    this.metrics.setGauge('circuit_breaker_state', { provider_id: this.providerId }, STATE_VALUES[next]);
  }
}

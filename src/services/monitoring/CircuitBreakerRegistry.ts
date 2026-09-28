import { inject, singleton } from 'tsyringe';
import logger from '../../utils/logger';
import {
  CircuitBreaker,
  DEFAULT_CIRCUIT_BREAKER_PARAMS,
  type BreakerSnapshot,
  type BreakerState,
  type CircuitBreakerParams,
} from './CircuitBreaker';
import { MetricsRegistry } from './MetricsRegistry';

/**
 * P3-01 — lazy per-provider circuit breakers, fed by `CallLogger.record()`
 * (one injection point — zero new call sites).
 *
 * Params: pushed by `MonitoringConfigService` on every load/save/reload
 * (`setParamsOverride`) so `monitoring_config.circuitBreaker` overrides take
 * effect live for all breakers. Push (not pull) is deliberate: this registry
 * sits on the provider instrumentation path (providers → CallLogger → here),
 * and importing `MonitoringConfigService` (or `contracts/monitoring`) from
 * here would create a circular import through the provider schema chain.
 * Until the first config load, the defaults apply.
 *
 * In-memory only — a restart resets every breaker (documented decision; the
 * `provider-down` rule + call-log windows cover the restart gap).
 */
@singleton()
export class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();
  private paramsOverride: Partial<CircuitBreakerParams> | null = null;

  constructor(@inject(MetricsRegistry) private readonly metrics: MetricsRegistry) {}

  /** Creates the breaker on first use. */
  getBreaker(providerId: string): CircuitBreaker {
    let breaker = this.breakers.get(providerId);
    if (!breaker) {
      breaker = new CircuitBreaker(providerId, () => this.currentParams(), this.metrics);
      this.breakers.set(providerId, breaker);
    }
    return breaker;
  }

  /** Current state, or null when the provider has no recorded calls yet. */
  getState(providerId: string): BreakerState | null {
    return this.breakers.get(providerId)?.currentState ?? null;
  }

  /** CallLogger hook — never throws (monitoring must not break the business path). */
  recordSuccess(providerId: string): void {
    this.safe(providerId, () => this.getBreaker(providerId).recordSuccess());
  }

  /** CallLogger hook — never throws (monitoring must not break the business path). */
  recordFailure(providerId: string, errorCode: string | null | undefined): void {
    this.safe(providerId, () => this.getBreaker(providerId).recordFailure(errorCode));
  }

  /** Provider ids whose breaker is currently OPEN (alert rule engine, provider-down breaker branch). */
  openProviderIds(): string[] {
    const out: string[] = [];
    for (const [providerId, breaker] of this.breakers) {
      if (breaker.currentState === 'open') out.push(providerId);
    }
    return out;
  }

  /** One snapshot per known provider (P1-08 `/api/monitoring/providers`). */
  snapshot(): Record<string, BreakerSnapshot> {
    const out: Record<string, BreakerSnapshot> = {};
    for (const [providerId, breaker] of this.breakers) {
      out[providerId] = breaker.snapshot();
    }
    return out;
  }

  /**
   * Called by MonitoringConfigService after load/save/reload with the stored
   * `circuitBreaker` settings. `null` clears back to defaults.
   */
  setParamsOverride(override: Partial<CircuitBreakerParams> | null): void {
    this.paramsOverride = override;
  }

  // --- internals ---

  /** Merges the pushed `monitoring_config.circuitBreaker` over the defaults (live). */
  private currentParams(): CircuitBreakerParams {
    const cb = this.paramsOverride;
    return {
      failureThreshold: cb?.failureThreshold ?? DEFAULT_CIRCUIT_BREAKER_PARAMS.failureThreshold,
      windowMs: cb?.windowMs ?? DEFAULT_CIRCUIT_BREAKER_PARAMS.windowMs,
      cooldownMs: cb?.cooldownMs ?? DEFAULT_CIRCUIT_BREAKER_PARAMS.cooldownMs,
    };
  }

  private safe(providerId: string, fn: () => void): void {
    try {
      fn();
    } catch (error) {
      logger.error({ providerId, error: (error as Error)?.message ?? String(error) }, 'CircuitBreakerRegistry: update failed — breaker state unchanged');
    }
  }
}

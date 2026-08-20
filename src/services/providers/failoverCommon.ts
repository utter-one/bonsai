/**
 * P3-04: Shared helpers for the non-LLM failover wrappers (TTS / ASR / storage).
 *
 * The semantics mirror the P3-03 `FailoverLlmProvider` (which stays frozen):
 * - breaker gating via `getState()` first (gating must not create registry entries);
 * - one retry after 500 ms for `timeout`/`server_error` setup failures;
 * - transition rows through `FallbackEventService` (awaited, never throwing);
 * - exhaustion: metric + awaited onError + throw the last original error.
 */
import { logger } from '../../utils/logger';
import { CircuitOpenError } from '../../errors';
import { classifyThirdPartyError } from '../../utils/errorClassification';
import type { CircuitBreakerRegistry } from '../monitoring/CircuitBreakerRegistry';
import type { FallbackEventService } from '../monitoring/FallbackEventService';
import type { MetricsRegistry } from '../monitoring/MetricsRegistry';
import { MonitoringContext } from '../monitoring/MonitoringContext';
import type { ErrorCallback } from '../../types/callbacks';

/** Setup-phase errors that get one retry (500 ms backoff) before moving down the chain. */
export const RETRYABLE_SETUP_CODES = new Set(['timeout', 'server_error']);

export const RETRY_BACKOFF_MS = 500;

/** Error code for a failover-relevant failure. */
export function classifySetupError(error: unknown): string {
  return classifyThirdPartyError(error).code;
}

export function isRetryableSetupError(error: unknown): boolean {
  return RETRYABLE_SETUP_CODES.has(classifySetupError(error));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Breaker gate (P3-01). Providers with no breaker yet (no recorded calls)
 * pass without creating one — gating must not pollute the breaker snapshot
 * with entries for providers that never logged a call.
 */
export function passBreakerGate(breakerRegistry: CircuitBreakerRegistry, providerId: string): boolean {
  try {
    if (breakerRegistry.getState(providerId) !== null) {
      breakerRegistry.getBreaker(providerId).beforeCall();
    }
    return true;
  } catch (error) {
    if (error instanceof CircuitOpenError) {
      logger.warn({ providerId }, 'Failover: provider skipped — circuit open');
      return false;
    }
    throw error;
  }
}

/**
 * Records a fallback transition row (via `FallbackEventService`) for a failed
 * step and its successor. `projectId`/`conversationId` come from the active
 * MonitoringContext when present. Returns the row id (null when the insert
 * failed or there is no successor).
 */
export async function recordTransition(
  fallbackEvents: FallbackEventService,
  opts: {
    primaryProviderId: string;
    failedProviderId: string;
    nextProviderId: string;
    reason: string;
    providerType: string;
    operation: string;
  },
): Promise<string | null> {
  const row = await fallbackEvents.record({
    providerId: opts.failedProviderId,
    fallbackProviderId: opts.nextProviderId,
    providerType: opts.providerType,
    operation: opts.operation,
    reason: opts.reason,
    projectId: MonitoringContext.current()?.projectId ?? null,
    conversationId: MonitoringContext.current()?.conversationId ?? null,
    success: false,
  });
  if (row) {
    logger.warn(
      { providerId: opts.failedProviderId, fallbackProviderId: opts.nextProviderId, reason: opts.reason, primaryId: opts.primaryProviderId },
      'Failover: setup-phase failure — trying next provider',
    );
  }
  return row?.id ?? null;
}

/** Flips the transition event (if any) whose fallback just served the request. */
export async function markTransitionSucceeded(fallbackEvents: FallbackEventService, rowId: string | null): Promise<void> {
  if (!rowId) return;
  await fallbackEvents.markSucceeded(rowId);
}

/**
 * Chain exhausted: bump the exhaustion metric, deliver `onError` once (awaited —
 * matches the runner's notifyError semantics), and return the last original error
 * for the caller to throw (a descriptive one when every step was breaker-skipped).
 */
export async function exhaustChain(opts: {
  metrics: MetricsRegistry;
  primaryId: string;
  providerCount: number;
  onError?: ErrorCallback;
  lastError: unknown;
}): Promise<Error> {
  const { metrics, primaryId, providerCount, onError, lastError } = opts;
  metrics.inc('provider_chain_exhausted_total', { provider_id: primaryId });
  const error = lastError instanceof Error
    ? lastError
    : lastError !== null
      ? new Error(String(lastError))
      : new Error(`All ${providerCount} providers in the failover chain for ${primaryId} are unavailable (circuit open)`);
  logger.error({ primaryId, message: error.message }, 'Provider chain exhausted');
  if (onError) {
    try {
      await onError(error);
    } catch (callbackError) {
      logger.error({ primaryId, error: (callbackError as Error)?.message }, 'Failover: error callback failed');
    }
  }
  return error;
}

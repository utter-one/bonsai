import { inject, singleton } from 'tsyringe';
import { container } from 'tsyringe';
import type { CallMetrics } from '../../db/schema';
import { classifyThirdPartyError } from '../../utils/errorClassification';
import logger from '../../utils/logger';
import { CallLogger } from './CallLogger';
import { HeartbeatRegistry } from './HeartbeatRegistry';
import { MetricsRegistry } from './MetricsRegistry';

/**
 * Central "1 third-party call = 1 provider_call_logs row + generic metrics"
 * path (P1-03). Every instrumented call site (provider bases, channel
 * connections, OAuth refresh, IMAP poll) records through here so row shape
 * and metric labels stay consistent.
 *
 * `record()` is synchronous, never throws and never awaits — monitoring must
 * not fail the business path.
 */

export interface ProviderCallRecord {
  providerId: string;
  providerType: string; // llm, asr, tts, storage, channel
  apiType: string;
  /** Fixed operation vocabulary (P1-03). Falls back to MonitoringContext via CallLogger. */
  operation?: string;
  model?: string | null;
  projectId?: string | null;
  conversationId?: string | null;
  durationMs: number;
  /** When `false`, `error` is classified via `classifyThirdPartyError`. */
  ok: boolean;
  error?: unknown;
  statusHttp?: number | null;
  fallbackProviderId?: string | null;
  /** Variant phase fields (streaming metrics) for the row's `metrics` jsonb. */
  metrics?: CallMetrics | null;
}

@singleton()
export class ProviderCallRecorder {
  constructor(
    @inject(CallLogger) private readonly callLogger: CallLogger,
    @inject(MetricsRegistry) private readonly metricsRegistry: MetricsRegistry,
  ) {}

  /**
   * Records one third-party call. Synchronous, never throws.
   */
  record(entry: ProviderCallRecord): void {
    try {
      if (!entry || typeof entry !== 'object') return;
      if (typeof entry.providerId !== 'string' || !entry.providerId) return;
      if (typeof entry.providerType !== 'string' || !entry.providerType) return;
      if (typeof entry.apiType !== 'string' || !entry.apiType) return;
      if (typeof entry.ok !== 'boolean' || typeof entry.durationMs !== 'number' || !Number.isFinite(entry.durationMs)) return;

      let errorCode: string | null = null;
      let statusHttp: number | null = entry.statusHttp ?? null;
      let errorText: string | null = null;
      if (!entry.ok) {
        const classified = classifyThirdPartyError(entry.error);
        errorCode = classified.code;
        if (statusHttp === null) statusHttp = classified.statusHttp ?? null;
        const message = entry.error instanceof Error ? entry.error.message : typeof entry.error === 'string' ? entry.error : String(entry.error ?? 'unknown error');
        errorText = message.slice(0, 1024);
      }

      const operation = entry.operation ?? 'unknown';
      this.callLogger.record({
        providerId: entry.providerId,
        providerType: entry.providerType,
        apiType: entry.apiType,
        operation: entry.operation,
        model: entry.model,
        projectId: entry.projectId,
        conversationId: entry.conversationId,
        ok: entry.ok,
        errorCode,
        statusHttp,
        durationMs: entry.durationMs,
        errorText,
        fallbackProviderId: entry.fallbackProviderId,
        metrics: entry.metrics,
      });

      const labels: Record<string, unknown> = {
        provider_id: entry.providerId,
        provider_type: entry.providerType,
        operation,
        ok: entry.ok,
        error_code: errorCode ?? 'none',
      };
      this.metricsRegistry.inc('provider_calls_total', labels);
      this.metricsRegistry.observe('provider_call_duration_ms', labels, entry.durationMs);
    } catch (err) {
      logger.error({ error: (err as Error)?.message ?? String(err) }, 'ProviderCallRecorder.record failed — call not recorded');
    }
  }
}

let cachedRecorder: ProviderCallRecorder | null = null;
let warnedUnresolvable = false;

const NOOP_RECORDER = {
  record(): void { /* container unavailable — monitoring disabled, business path untouched */ },
};

/**
 * Accessor for non-DI classes (provider base instances are constructed with
 * `new`, channel connections and IMAP mailbox sessions are plain classes).
 * Cached after first resolve; falls back to a no-op (one-time pino error)
 * if the container cannot resolve — monitoring must never break the caller.
 */
export function getProviderCallRecorder(): ProviderCallRecorder | typeof NOOP_RECORDER {
  if (cachedRecorder) return cachedRecorder;
  try {
    cachedRecorder = container.resolve(ProviderCallRecorder);
    return cachedRecorder;
  } catch (err) {
    if (!warnedUnresolvable) {
      warnedUnresolvable = true;
      logger.error({ error: (err as Error)?.message ?? String(err) }, 'ProviderCallRecorder: container resolve failed — provider call recording disabled');
    }
    return NOOP_RECORDER;
  }
}

let cachedMetricsRegistry: MetricsRegistry | null = null;

/** Accessor for non-DI classes needing direct gauge/counter updates. */
export function getMetricsRegistry(): MetricsRegistry | null {
  if (cachedMetricsRegistry) return cachedMetricsRegistry;
  try {
    cachedMetricsRegistry = container.resolve(MetricsRegistry);
    return cachedMetricsRegistry;
  } catch {
    return null;
  }
}

let cachedHeartbeatRegistry: HeartbeatRegistry | null = null;

/**
 * Accessor for non-DI classes that must heartbeat their loops (P1-05: the plain-class
 * `ImapMailboxSession` poll loop). Same NOOP-fallback contract as `getProviderCallRecorder`.
 */
export function getHeartbeatRegistry(): HeartbeatRegistry | null {
  if (cachedHeartbeatRegistry) return cachedHeartbeatRegistry;
  try {
    cachedHeartbeatRegistry = container.resolve(HeartbeatRegistry);
    return cachedHeartbeatRegistry;
  } catch {
    return null;
  }
}

/** Test seam: clears cached singletons so a fresh container is picked up. */
export function resetMonitoringAccessorsForTests(): void {
  cachedRecorder = null;
  cachedMetricsRegistry = null;
  cachedHeartbeatRegistry = null;
  warnedUnresolvable = false;
}

/**
 * P1-03: records one `channel.webhook` call-log row when the given HTTP
 * response finishes, using the status code the host actually returned.
 * `ok = statusCode < 400`. Call at the top of an inbound webhook handler,
 * after the channel provider id is known (empty ids are skipped).
 * `recorder` is optional (test seam); defaults to the container accessor.
 * Never throws.
 */
export function trackWebhookOutcome(res: { on(event: 'finish', listener: () => void): unknown; statusCode: number }, providerId: string, apiType: string, recorder?: { record(entry: ProviderCallRecord): void }): void {
  if (!providerId) return;
  res.on('finish', () => {
    try {
      const status = res.statusCode;
      (recorder ?? getProviderCallRecorder()).record({
        providerId,
        providerType: 'channel',
        apiType,
        operation: 'channel.webhook',
        durationMs: 0,
        ok: status < 400,
        statusHttp: status,
        error: status < 400 ? undefined : new Error(`Webhook responded with HTTP ${status}`),
      });
    } catch { /* monitoring must never break the business path */ }
  });
}

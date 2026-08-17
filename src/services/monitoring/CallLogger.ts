import { singleton } from 'tsyringe';
import { db } from '../../db';
import { providerCallLogs } from '../../db/schema';
import type { CallMetrics } from '../../db/schema';
import { generateId } from '../../utils/idGenerator';
import logger from '../../utils/logger';
import { MonitoringContext } from './MonitoringContext';

/**
 * Bounded in-memory buffer for provider_call_logs rows (PROPOSAL §3.2a).
 *
 * `record()` is synchronous, never throws and never awaits — it is safe to
 * call from any business path (provider bases, channel sends). Rows flush
 * every 5s or at 200 buffered rows (whichever first) via a batched
 * multi-row INSERT. On flush failure the rows are re-queued (bounded —
 * oldest dropped with a pino error) and the failure is reported once;
 * monitoring never fails the business path.
 */

export interface ProviderCallEntry {
  providerId: string;
  providerType: string;
  apiType: string;
  /** Optional — falls back to MonitoringContext.current().operation, then 'unknown'. */
  operation?: string;
  model?: string | null;
  projectId?: string | null;
  conversationId?: string | null;
  ok: boolean;
  errorCode?: string | null;
  statusHttp?: number | null;
  durationMs: number;
  /** Truncated to 1KB at the write layer. */
  errorText?: string | null;
  /** Set when this call executed on a fallback provider (P3). */
  fallbackProviderId?: string | null;
  /** Variant-specific phase fields (streaming metrics), null for non-streaming ops. */
  metrics?: CallMetrics | null;
}

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_THRESHOLD_ROWS = 200;
const ERROR_TEXT_MAX_CHARS = 1024;
const DEFAULT_BUFFER_SIZE = 10_000;
const OVERFLOW_WARN_THROTTLE_MS = FLUSH_INTERVAL_MS;

export interface ProviderCallLogRow {
  id: string;
  providerId: string;
  providerType: string;
  apiType: string;
  operation: string;
  model: string | null;
  projectId: string | null;
  conversationId: string | null;
  ok: boolean;
  errorCode: string | null;
  statusHttp: number | null;
  durationMs: number;
  errorText: string | null;
  fallbackProviderId: string | null;
  metrics: CallMetrics | null;
  createdAt: Date;
}

function readBufferSizeFromEnv(): number {
  const raw = process.env.MONITORING_CALL_LOG_BUFFER_SIZE;
  if (!raw) return DEFAULT_BUFFER_SIZE;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BUFFER_SIZE;
}

@singleton()
export class CallLogger {
  private buffer: ProviderCallEntry[] = [];
  private readonly bufferSize: number;
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private lastOverflowWarnAt = 0;
  lastFlushError: unknown = null;

  constructor() {
    this.bufferSize = readBufferSizeFromEnv();
  }

  /**
   * Buffers a provider call row. Synchronous, never throws.
   * projectId/conversationId/operation are filled from MonitoringContext
   * when not provided explicitly (set by ConversationRunner / channel hosts, P1-03).
   */
  record(entry: ProviderCallEntry): void {
    try {
      if (!this.isValid(entry)) {
        logger.warn(`CallLogger: invalid entry dropped (providerId=${entry?.providerId}, operation=${entry?.operation})`);
        return;
      }
      const ctx = MonitoringContext.current();
      const full: ProviderCallEntry = {
        ...entry,
        operation: entry.operation || ctx?.operation || 'unknown',
        projectId: entry.projectId ?? ctx?.projectId ?? null,
        conversationId: entry.conversationId ?? ctx?.conversationId ?? null,
      };
      this.buffer.push(full);
      if (this.buffer.length > this.bufferSize) {
        this.buffer.shift(); // bounded: drop oldest
        const now = Date.now();
        if (now - this.lastOverflowWarnAt >= OVERFLOW_WARN_THROTTLE_MS) {
          this.lastOverflowWarnAt = now;
          logger.error(`CallLogger: buffer overflow — dropping oldest entries (buffer size ${this.bufferSize}); check DB health or raise MONITORING_CALL_LOG_BUFFER_SIZE`);
        }
      }
      if (this.buffer.length >= FLUSH_THRESHOLD_ROWS) {
        void this.flushNow();
      }
    } catch (err) {
      // Absolute last-resort guard: monitoring must never break the business path.
      logger.error({ error: (err as Error)?.message ?? String(err) }, 'CallLogger.record failed unexpectedly — entry dropped');
    }
  }

  /** Starts the 5s flush interval. Idempotent. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.buffer.length > 0) void this.flushNow();
    }, FLUSH_INTERVAL_MS);
    logger.info(`CallLogger started (flush every ${FLUSH_INTERVAL_MS}ms or ${FLUSH_THRESHOLD_ROWS} rows, buffer ${this.bufferSize})`);
  }

  /** Stops the flush interval. Call `flushNow()` first on shutdown (P1-09). */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('CallLogger stopped');
    }
  }

  /** Drains the buffer and inserts the rows. Never throws. */
  async flushNow(): Promise<void> {
    if (this.flushing) return;
    // Synchronous drain: entries recorded while the insert runs buffer fresh.
    const entries = this.buffer.splice(0, this.buffer.length);
    if (!entries.length) return;
    this.flushing = true;
    try {
      const rows = entries.map((entry) => toRow(entry));
      try {
        await this.persistRows(rows);
      } catch (err) {
        // Re-queue failed rows ahead of newer ones; bounded by bufferSize (oldest dropped).
        const combined = [...entries, ...this.buffer];
        this.buffer = combined.slice(Math.max(0, combined.length - this.bufferSize));
        this.lastFlushError = err;
        this.onFlushError(err);
      }
    } finally {
      this.flushing = false;
    }
  }

  // --- internals (protected seams for unit tests) ---

  protected async persistRows(rows: ProviderCallLogRow[]): Promise<void> {
    await db.insert(providerCallLogs).values(rows);
  }

  protected onFlushError(err: unknown): void {
    logger.error({ error: (err as Error)?.message ?? String(err) }, 'CallLogger flush to provider_call_logs failed — rows kept in buffer, retrying next interval');
  }

  private isValid(entry: ProviderCallEntry): boolean {
    if (!entry || typeof entry !== 'object') return false;
    if (typeof entry.providerId !== 'string' || !entry.providerId) return false;
    if (typeof entry.providerType !== 'string' || !entry.providerType) return false;
    if (typeof entry.apiType !== 'string' || !entry.apiType) return false;
    if (typeof entry.ok !== 'boolean') return false;
    return typeof entry.durationMs === 'number' && Number.isFinite(entry.durationMs);
  }
}

function toRow(entry: ProviderCallEntry): ProviderCallLogRow {
  const errorText = entry.errorText
    ? entry.errorText.slice(0, ERROR_TEXT_MAX_CHARS)
    : null;
  return {
    id: generateId('clgl'),
    providerId: entry.providerId,
    providerType: entry.providerType,
    apiType: entry.apiType,
    operation: entry.operation || 'unknown',
    model: entry.model ?? null,
    projectId: entry.projectId ?? null,
    conversationId: entry.conversationId ?? null,
    ok: entry.ok,
    errorCode: entry.errorCode ?? null,
    statusHttp: entry.statusHttp ?? null,
    durationMs: entry.durationMs,
    errorText,
    fallbackProviderId: entry.fallbackProviderId ?? null,
    metrics: entry.metrics ?? null,
    createdAt: new Date(),
  };
}

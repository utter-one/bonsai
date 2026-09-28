import type { CallMetrics } from '../../db/schema';

/**
 * Per-call streaming accumulator (P1-03).
 *
 * Provider bases create one instance per call/session, feed it from the
 * existing notify* hooks / chunk callbacks, and pass it to the recorder at
 * the call boundary. Pure data + timing math — no IO, no DI.
 */
export class StreamStats {
  readonly operation: string;
  readonly startedAt: number;
  firstChunkAt: number | null = null;
  lastChunkAt: number | null = null;
  maxChunkGapMs: number | null = null;
  chunksCount = 0;
  finishReason: string | null = null;
  tokensPrompt: number | null = null;
  tokensCompletion: number | null = null;
  /** True once a unit (chunk/audio frame) has been delivered — drives LLM errorPhase. */
  delivered = false;

  constructor(operation: string, startedAt: number = Date.now()) {
    this.operation = operation;
    this.startedAt = startedAt;
  }

  /** Records delivery of one unit (LLM chunk, TTS audio chunk). */
  onUnit(unitAt: number = Date.now()): void {
    if (this.firstChunkAt === null) {
      this.firstChunkAt = unitAt;
    }
    if (this.lastChunkAt !== null) {
      const gap = unitAt - this.lastChunkAt;
      if (this.maxChunkGapMs === null || gap > this.maxChunkGapMs) {
        this.maxChunkGapMs = gap;
      }
    }
    this.lastChunkAt = unitAt;
    this.chunksCount += 1;
    this.delivered = true;
  }

  get ttftMs(): number | null {
    return this.firstChunkAt !== null ? this.firstChunkAt - this.startedAt : null;
  }

  /** Wall duration of the call/session so far. */
  durationMs(endAt: number = Date.now()): number {
    return Math.max(0, endAt - this.startedAt);
  }

  /** Phase fields for the call-log row's `metrics` jsonb (CallMetrics). */
  toCallMetrics(): CallMetrics {
    const metrics: CallMetrics = {};
    if (this.ttftMs !== null) metrics.ttftMs = this.ttftMs;
    if (this.chunksCount > 0) metrics.chunksCount = this.chunksCount;
    if (this.maxChunkGapMs !== null) metrics.maxChunkGapMs = this.maxChunkGapMs;
    if (this.finishReason !== null) metrics.finishReason = this.finishReason;
    if (this.tokensPrompt !== null) metrics.tokensPrompt = this.tokensPrompt;
    if (this.tokensCompletion !== null) metrics.tokensCompletion = this.tokensCompletion;
    return metrics;
  }
}

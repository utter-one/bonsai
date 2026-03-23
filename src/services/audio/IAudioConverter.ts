/**
 * The conversion strategy tier chosen for a particular format pair,
 * ordered from fastest to slowest.
 */
export type ConverterTier = 'passthrough' | 'speex' | 'opus' | 'g711' | 'ffmpeg';

/**
 * Common interface for all bidirectional audio format converters.
 * Implementations are session-scoped and reused across turns via reset().
 * All converters emit typed events: 'data' (converted chunk), 'error', and 'end'.
 */
export interface IAudioConverter {
  /** Feed a raw audio chunk into the converter. */
  push(chunk: Buffer): void;
  /** Signal end of input stream for the current turn. */
  end(): void;
  /**
   * Reset internal state for reuse across turns without re-initialization.
   * Stateless converters implement this as a no-op.
   * ffmpeg-backed converters respawn the child process.
   */
  reset(): void;
  /** Release all resources held by this converter. */
  destroy(): void;
  on(event: 'data', cb: (chunk: Buffer) => void): this;
  on(event: 'error', cb: (err: Error) => void): this;
  on(event: 'end', cb: () => void): this;
}

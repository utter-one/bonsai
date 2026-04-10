/**
 * Stateful ring buffer that accumulates arbitrary PCM chunks and yields
 * complete 20 ms Opus frames (960 samples × 2 bytes = 1920 bytes at 48 kHz mono 16-bit).
 * Used internally by OpusConverter to ensure the encoder always receives full frames.
 */
export class OpusFrameAligner {
  private static readonly FRAME_BYTES = 1920; // 960 samples × 2 bytes

  private buffer: Buffer = Buffer.alloc(0);

  /**
   * Feeds a chunk of 48 kHz 16-bit mono PCM data.
   * Returns an array of complete 1920-byte frames (may be empty).
   */
  push(chunk: Buffer): Buffer[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: Buffer[] = [];
    while (this.buffer.length >= OpusFrameAligner.FRAME_BYTES) {
      frames.push(this.buffer.subarray(0, OpusFrameAligner.FRAME_BYTES));
      this.buffer = this.buffer.subarray(OpusFrameAligner.FRAME_BYTES);
    }
    return frames;
  }

  /**
   * Returns any leftover data zero-padded to a full frame, or null if the buffer is empty.
   * Call this after the last push() to flush the final partial frame.
   */
  flush(): Buffer | null {
    if (this.buffer.length === 0) return null;
    const padded = Buffer.alloc(OpusFrameAligner.FRAME_BYTES);
    this.buffer.copy(padded);
    this.buffer = Buffer.alloc(0);
    return padded;
  }

  /** Clears the internal buffer, discarding any buffered data. */
  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

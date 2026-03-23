import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import type { IAudioConverter } from './IAudioConverter';
import type { AudioFormat } from '../../types/audio';
import { buildFfmpegArgs } from './AudioFormatUtils';

/**
 * Audio converter that uses a spawned ffmpeg process for format pairs not
 * supported by the in-process tiers (e.g. mp3, aac, flac, wav).
 * This is the last-resort tier; prefer the faster in-process converters when possible.
 *
 * reset() kills the current process and spawns a fresh one, so the converter
 * is reusable across turns despite the subprocess overhead.
 */
export class FfmpegAudioConverter extends EventEmitter implements IAudioConverter {
  private process: ChildProcess | null = null;

  constructor(
    private readonly from: AudioFormat,
    private readonly to: AudioFormat,
    private readonly ffmpegPath: string,
  ) {
    super();
    this.spawnProcess();
  }

  /** Write a chunk to ffmpeg's stdin. */
  push(chunk: Buffer): void {
    if (this.process?.stdin) {
      this.process.stdin.write(chunk);
    }
  }

  /** Close ffmpeg's stdin so it can flush and exit. */
  end(): void {
    this.process?.stdin?.end();
  }

  /**
   * Kills the current ffmpeg process and spawns a fresh one.
   * Resets the converter for use in the next turn.
   */
  reset(): void {
    this.killProcess();
    this.spawnProcess();
  }

  /** Kills the ffmpeg process and releases resources. */
  destroy(): void {
    this.killProcess();
  }

  private spawnProcess(): void {
    const args = buildFfmpegArgs(this.from, this.to);
    this.process = spawn(this.ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.emit('data', chunk);
    });

    this.process.stdout?.on('end', () => {
      this.emit('end');
    });

    this.process.stderr?.on('data', () => {
      // Suppress ffmpeg diagnostic output; errors are surfaced via exit code
    });

    this.process.on('error', (err: Error) => {
      this.emit('error', new Error(`ffmpeg process error: ${err.message}`));
    });

    this.process.on('close', (code: number | null) => {
      if (code !== null && code !== 0) {
        this.emit('error', new Error(`ffmpeg exited with code ${code}`));
      }
    });
  }

  private killProcess(): void {
    if (this.process) {
      this.process.stdout?.removeAllListeners();
      this.process.stderr?.removeAllListeners();
      this.process.removeAllListeners();
      this.process.kill();
      this.process = null;
    }
  }
}

import { singleton } from 'tsyringe';
import { parseEnvInt } from '../utils/env';

type WindowEntry = {
  count: number;
  resetAt: number;
};

/**
 * In-memory rate limiter for WebSocket authentication attempts.
 * Uses a fixed-window counter keyed by client IP address.
 * Expired entries are periodically pruned to prevent unbounded memory growth.
 * Configurable via environment variables:
 * - RATE_LIMIT_WS_AUTH_WINDOW_MS: window duration in ms (default: 900000 = 15 minutes)
 * - RATE_LIMIT_WS_AUTH_MAX: max attempts per window per IP (default: 10)
 */
@singleton()
export class WsRateLimiter {
  private readonly windowMs: number;
  private readonly max: number;
  private readonly entries: Map<string, WindowEntry> = new Map();
  private pruneTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.windowMs = parseEnvInt('RATE_LIMIT_WS_AUTH_WINDOW_MS', 900_000);
    this.max = parseEnvInt('RATE_LIMIT_WS_AUTH_MAX', 10);
    // Prune expired entries once per window to prevent unbounded map growth
    this.pruneTimer = setInterval(() => this.pruneExpired(), this.windowMs);
    this.pruneTimer.unref();
  }

  /**
   * Attempts to consume one slot for the given IP.
   * Resets the window automatically when it has expired.
   * @returns true if the request is allowed, false if the rate limit is exceeded.
   */
  tryConsume(ip: string): boolean {
    const now = Date.now();
    const entry = this.entries.get(ip);

    if (!entry || now >= entry.resetAt) {
      this.entries.set(ip, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (entry.count >= this.max) {
      return false;
    }

    entry.count++;
    return true;
  }

  /**
   * Returns the number of seconds remaining until the window resets for the given IP.
   */
  getRetryAfterSeconds(ip: string): number {
    const entry = this.entries.get(ip);
    if (!entry) return 0;
    return Math.max(0, Math.ceil((entry.resetAt - Date.now()) / 1000));
  }

  /** Removes entries whose windows have already expired. */
  private pruneExpired(): void {
    const now = Date.now();
    for (const [ip, entry] of this.entries) {
      if (now >= entry.resetAt) {
        this.entries.delete(ip);
      }
    }
  }
}


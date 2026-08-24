import logger from '../utils/logger';

/**
 * Graceful shutdown (P1-09).
 *
 * Installs SIGTERM/SIGINT handlers that run an ordered shutdown:
 *   1. stop background services (no new work)
 *   2. stop accepting new HTTP (in-flight requests finish)
 *   3. drain interactive channels (WebSocket + Twilio voice) — 1001 "going away",
 *      bounded by the grace period, force-terminate stragglers
 *   4. flush monitoring buffers (bounded), stop their flush intervals
 *   5. close the pg pool
 *   6. process.exit(0)
 *
 * A second signal during shutdown forces process.exit(1) immediately, and a hard
 * outer timeout (30 s default) forces exit(1) if any step hangs.
 *
 * The dependency surface is structural on purpose: src/index.ts wires the real
 * container singletons, unit tests pass stubs.
 */
export interface ShutdownDeps {
  server: {
    close(callback: (err?: Error) => void): unknown;
    closeIdleConnections?: () => void;
  };
  /** Background services + HealthCheckService, in stop order. */
  services: Array<{ name: string; stop(): void }>;
  websocketHost: {
    close(): void;
    getOpenSocketCount(): number;
    terminateOpenSockets(): number;
  };
  voiceHost: {
    close(): void;
    getOpenSocketCount(): number;
    terminateOpenSockets(): number;
  };
  callLogger: {
    readonly pendingCount: number;
    flushNow(): Promise<void>;
    /** Resolves when a concurrent in-flight flush completes (see runShutdown step 4). */
    settled(): Promise<void>;
    stop(): void;
  };
  metricsRegistry: {
    pendingRowCount(): number;
    flushNow(): Promise<void>;
    /** Resolves when a concurrent in-flight flush completes (see runShutdown step 4). */
    settled(): Promise<void>;
    stop(): void;
  };
  endPool(): Promise<void>;
  /** Max ms to wait for connection drains (default 10_000, from SHUTDOWN_GRACE_MS). */
  graceMs?: number;
  /** Hard outer timeout from signal to forced exit (default 30_000). */
  hardTimeoutMs?: number;
}

const DEFAULT_GRACE_MS = 10_000;
const DEFAULT_HARD_TIMEOUT_MS = 30_000;
const FLUSH_TIMEOUT_MS = 5_000;
const DRAIN_POLL_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Installs the SIGTERM/SIGINT shutdown handlers. Returns an uninstall function
 * (removes both listeners) for test teardown.
 */
export function installShutdownHandlers(deps: ShutdownDeps): () => void {
  const graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;
  const hardTimeoutMs = deps.hardTimeoutMs ?? DEFAULT_HARD_TIMEOUT_MS;
  let shuttingDown = false;
  let hardTimer: NodeJS.Timeout | null = null;

  const runShutdown = async (signal: NodeJS.Signals): Promise<void> => {
    try {
      // 1. Stop background services — no new work starts.
      for (const service of deps.services) {
        try {
          service.stop();
        } catch (error) {
          logger.warn({ service: service.name, error: (error as Error)?.message ?? String(error) }, 'Shutdown: service stop failed — continuing');
        }
      }

      // 2. Stop accepting new HTTP; release idle keep-alive connections now, in-flight
      // requests finish. Not awaited yet — Node fires the close callback only when ALL
      // connections (including upgraded WS sockets) are done, so awaiting before the
      // drain would deadlock behind the sockets the drain closes.
      const serverClosed = new Promise<void>((resolve) => {
        deps.server.close(() => resolve());
        deps.server.closeIdleConnections?.();
      });

      // 3. Drain interactive channels.
      const openTotal = () => deps.websocketHost.getOpenSocketCount() + deps.voiceHost.getOpenSocketCount();
      const openBefore = openTotal();
      logger.info(
        { websockets: deps.websocketHost.getOpenSocketCount(), voiceStreams: deps.voiceHost.getOpenSocketCount() },
        'Shutdown: closing interactive connections (1001 going away)',
      );
      deps.websocketHost.close();
      deps.voiceHost.close();

      if (openBefore > 0) {
        const deadline = Date.now() + graceMs;
        while (openTotal() > 0 && Date.now() < deadline) {
          await sleep(DRAIN_POLL_MS);
        }
        if (openTotal() > 0) {
          const terminated = deps.websocketHost.terminateOpenSockets() + deps.voiceHost.terminateOpenSockets();
          logger.warn({ remaining: openTotal(), terminated }, 'Shutdown: grace period expired — force-terminated remaining connections');
          // Give the terminate-triggered close handlers (session cleanup) a moment.
          const cleanupDeadline = Date.now() + DRAIN_POLL_MS * 5;
          while (openTotal() > 0 && Date.now() < cleanupDeadline) {
            await sleep(DRAIN_POLL_MS);
          }
        }
      }

      await serverClosed;

      // 4. Flush monitoring buffers (bounded — a stuck flush must not stall shutdown;
      // the hard timeout is the backstop either way), then stop the flush intervals.
      // Per logger: initial drain → stop (no new interval/threshold flushes can start) →
      // settle a concurrent in-flight flush (its insert must finish before endPool) →
      // final drain (records made while the first insert was running).
      try {
        await withTimeout(deps.callLogger.flushNow(), FLUSH_TIMEOUT_MS, 'CallLogger.flushNow');
      } catch (error) {
        logger.warn({ error: (error as Error)?.message }, 'Shutdown: CallLogger flush did not complete in time');
      }
      deps.callLogger.stop();
      try {
        await withTimeout(deps.callLogger.settled(), FLUSH_TIMEOUT_MS, 'CallLogger.settled');
      } catch (error) {
        logger.warn({ error: (error as Error)?.message }, 'Shutdown: CallLogger in-flight flush did not settle in time');
      }
      try {
        await withTimeout(deps.callLogger.flushNow(), FLUSH_TIMEOUT_MS, 'CallLogger final flush');
      } catch (error) {
        logger.warn({ error: (error as Error)?.message }, 'Shutdown: CallLogger final flush did not complete in time');
      }
      try {
        await withTimeout(deps.metricsRegistry.flushNow(), FLUSH_TIMEOUT_MS, 'MetricsRegistry.flushNow');
      } catch (error) {
        logger.warn({ error: (error as Error)?.message }, 'Shutdown: MetricsRegistry flush did not complete in time');
      }
      deps.metricsRegistry.stop();
      try {
        await withTimeout(deps.metricsRegistry.settled(), FLUSH_TIMEOUT_MS, 'MetricsRegistry.settled');
      } catch (error) {
        logger.warn({ error: (error as Error)?.message }, 'Shutdown: MetricsRegistry in-flight flush did not settle in time');
      }
      try {
        await withTimeout(deps.metricsRegistry.flushNow(), FLUSH_TIMEOUT_MS, 'MetricsRegistry final flush');
      } catch (error) {
        logger.warn({ error: (error as Error)?.message }, 'Shutdown: MetricsRegistry final flush did not complete in time');
      }
      logger.info(
        { callLogPending: deps.callLogger.pendingCount, metricSamplesPending: deps.metricsRegistry.pendingRowCount() },
        'Shutdown: monitoring buffers flushed',
      );

      // 5. Close the DB pool (checked-out clients return; a stuck query hits the hard timeout).
      await deps.endPool();

      logger.info({ signal }, 'Shutdown complete');
      if (hardTimer) clearTimeout(hardTimer);
      process.exit(0);
    } catch (error) {
      logger.error({ error: (error as Error)?.message ?? String(error) }, 'Shutdown: unexpected failure — forcing exit');
      if (hardTimer) clearTimeout(hardTimer);
      process.exit(1);
    }
  };

  const onSignal = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      logger.warn({ signal }, 'Shutdown: second signal received — forcing exit');
      process.exit(1);
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    hardTimer = setTimeout(() => {
      hardTimer = null;
      logger.error({ hardTimeoutMs }, 'Shutdown: hard timeout exceeded — forcing exit');
      process.exit(1);
    }, hardTimeoutMs);
    void runShutdown(signal);
  };

  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);

  return () => {
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
    // A shutdown still in flight (e.g. tests) must not leave the hard timer behind —
    // it would fire later with a restored process.exit and kill the surrounding process.
    if (hardTimer) {
      clearTimeout(hardTimer);
      hardTimer = null;
    }
  };
}

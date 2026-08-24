import 'reflect-metadata';
import { describe, it } from 'mocha';
import { expect } from 'chai';
import { installShutdownHandlers } from '../../../src/utils/shutdown';
import type { ShutdownDeps } from '../../../src/utils/shutdown';

/**
 * P1-09 shutdown sequence tests — stubbed deps, driven via process.emit.
 *
 * process.exit is patched per test (recorded, not actually called — the patch
 * returns normally so runShutdown finishes cleanly instead of re-entering its
 * catch path). The hard timeout defaults to 60 s so it never fires mid-suite
 * except in the dedicated timeout test, where it fires inside the test and is
 * consumed.
 */

interface World {
  calls: string[];
  deps: ShutdownDeps;
  setWsOpen(n: number): void;
  setVoiceOpen(n: number): void;
  deferServerClose(): void;
  hangEndPool(): void;
}

function makeWorld(overrides: Partial<ShutdownDeps> = {}): World {
  const calls: string[] = [];
  let wsOpen = 0;
  let voiceOpen = 0;
  let serverCloseDeferred = false;
  let hangEndPool = false;

  const deps: ShutdownDeps = {
    server: {
      close: (cb) => {
        calls.push('server.close');
        if (!serverCloseDeferred) cb();
      },
      closeIdleConnections: () => calls.push('closeIdleConnections'),
    },
    services: [
      { name: 'svcA', stop: () => calls.push('stop:svcA') },
      { name: 'svcB', stop: () => calls.push('stop:svcB') },
    ],
    websocketHost: {
      close: () => calls.push('wsHost.close'),
      getOpenSocketCount: () => wsOpen,
      terminateOpenSockets: () => {
        calls.push('wsHost.terminate');
        const n = wsOpen;
        wsOpen = 0;
        return n;
      },
    },
    voiceHost: {
      close: () => calls.push('voiceHost.close'),
      getOpenSocketCount: () => voiceOpen,
      terminateOpenSockets: () => {
        calls.push('voiceHost.terminate');
        const n = voiceOpen;
        voiceOpen = 0;
        return n;
      },
    },
    callLogger: {
      pendingCount: 0,
      flushNow: async () => {
        calls.push('callLogger.flushNow');
      },
      settled: async () => {
        calls.push('callLogger.settled');
      },
      stop: () => calls.push('callLogger.stop'),
    },
    metricsRegistry: {
      pendingRowCount: () => 0,
      flushNow: async () => {
        calls.push('metricsRegistry.flushNow');
      },
      settled: async () => {
        calls.push('metricsRegistry.settled');
      },
      stop: () => calls.push('metricsRegistry.stop'),
    },
    endPool: () => {
      if (hangEndPool) return new Promise<void>(() => {});
      calls.push('endPool');
      return Promise.resolve();
    },
    graceMs: 150,
    hardTimeoutMs: 60_000,
    ...overrides,
  };

  return {
    calls,
    deps,
    setWsOpen: (n: number) => {
      wsOpen = n;
    },
    setVoiceOpen: (n: number) => {
      voiceOpen = n;
    },
    deferServerClose: () => {
      serverCloseDeferred = true;
    },
    hangEndPool: () => {
      hangEndPool = true;
    },
  };
}

async function runWithPatchedExit(exits: number[], fn: () => Promise<void>): Promise<void> {
  const realExit = process.exit;
  (process as unknown as { exit: (code?: number) => void }).exit = (code?: number) => {
    exits.push(typeof code === 'number' ? code : 0);
  };
  try {
    await fn();
  } finally {
    process.exit = realExit;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!predicate()) throw new Error('waitFor timed out');
}

describe('P1-09 graceful shutdown', () => {
  it('runs the ordered sequence and exits 0', async () => {
    const world = makeWorld();
    const exits: number[] = [];
    const uninstall = installShutdownHandlers(world.deps);
    try {
      await runWithPatchedExit(exits, async () => {
        process.emit('SIGTERM', 'SIGTERM');
        await waitFor(() => exits.length > 0, 2000);
      });
    } finally {
      uninstall();
    }

    expect(exits).to.deep.equal([0]);
    expect(world.calls).to.deep.equal([
      'stop:svcA',
      'stop:svcB',
      'server.close',
      'closeIdleConnections',
      'wsHost.close',
      'voiceHost.close',
      // initial drain → stop → settle concurrent in-flight flush → final drain
      'callLogger.flushNow',
      'callLogger.stop',
      'callLogger.settled',
      'callLogger.flushNow',
      'metricsRegistry.flushNow',
      'metricsRegistry.stop',
      'metricsRegistry.settled',
      'metricsRegistry.flushNow',
      'endPool',
    ]);
  });

  it('second signal during shutdown forces exit 1', async () => {
    const world = makeWorld();
    world.hangEndPool(); // keep the first shutdown in flight
    const exits: number[] = [];
    const uninstall = installShutdownHandlers(world.deps);
    try {
      await runWithPatchedExit(exits, async () => {
        process.emit('SIGTERM', 'SIGTERM');
        // Let the first shutdown progress until it hangs in endPool, so the
        // second signal arrives while shutdown is genuinely in flight.
        await waitFor(() => world.calls.includes('metricsRegistry.stop'), 500);
        process.emit('SIGTERM', 'SIGTERM');
        await waitFor(() => exits.includes(1), 200);
      });
    } finally {
      uninstall();
    }

    expect(exits).to.include(1);
    // The first shutdown progressed through the flush and hung in endPool — it never completed.
    expect(world.calls).to.include('metricsRegistry.stop');
    expect(world.calls).to.not.include('endPool');
  });

  it('hard timeout forces exit 1 when a step hangs', async () => {
    const world = makeWorld({ hardTimeoutMs: 300 });
    world.deferServerClose(); // server.close callback never fires → await hangs
    const exits: number[] = [];
    const uninstall = installShutdownHandlers(world.deps);
    try {
      await runWithPatchedExit(exits, async () => {
        process.emit('SIGTERM', 'SIGTERM');
        await waitFor(() => exits.length > 0, 3000);
      });
    } finally {
      uninstall();
    }

    expect(exits[0]).to.equal(1);
    expect(world.calls).to.not.include('endPool');
    expect(world.calls).to.not.include('callLogger.flushNow');
  });

  it('force-terminates sockets still open after the grace period, then exits 0', async () => {
    const world = makeWorld();
    world.setWsOpen(2);
    world.setVoiceOpen(1); // never close
    const exits: number[] = [];
    const uninstall = installShutdownHandlers(world.deps);
    const t0 = Date.now();
    try {
      await runWithPatchedExit(exits, async () => {
        process.emit('SIGTERM', 'SIGTERM');
        await waitFor(() => exits.length > 0, 3000);
      });
    } finally {
      uninstall();
    }

    const elapsed = Date.now() - t0;
    expect(world.calls).to.include('wsHost.terminate');
    expect(world.calls).to.include('voiceHost.terminate');
    expect(exits[0]).to.equal(0);
    expect(world.calls).to.include('endPool');
    expect(elapsed).to.be.at.least(100); // waited out the grace window
  });

  it('continues when a service stop throws', async () => {
    const world = makeWorld();
    world.deps.services[0].stop = () => {
      throw new Error('boom');
    };
    const exits: number[] = [];
    const uninstall = installShutdownHandlers(world.deps);
    try {
      await runWithPatchedExit(exits, async () => {
        process.emit('SIGTERM', 'SIGTERM');
        await waitFor(() => exits.length > 0, 2000);
      });
    } finally {
      uninstall();
    }

    expect(exits).to.deep.equal([0]);
    expect(world.calls).to.include('stop:svcB');
    expect(world.calls).to.include('endPool');
  });

  it('idle shutdown (no open sockets) skips the grace wait', async () => {
    const world = makeWorld({ graceMs: 2000 });
    const exits: number[] = [];
    const uninstall = installShutdownHandlers(world.deps);
    const t0 = Date.now();
    try {
      await runWithPatchedExit(exits, async () => {
        process.emit('SIGTERM', 'SIGTERM');
        await waitFor(() => exits.length > 0, 2000);
      });
    } finally {
      uninstall();
    }

    expect(exits).to.deep.equal([0]);
    expect(Date.now() - t0).to.be.below(500); // graceMs is 2 s — must not be waited
  });

  it('settles a concurrent in-flight flush before closing the pool', async () => {
    const world = makeWorld();
    // Simulate an interval-triggered flush already running when shutdown starts:
    // the first flushNow no-ops (the `flushing` guard), settled() resolves only when
    // that in-flight insert finishes, and the final drain must run before endPool.
    let inFlightDone = false;
    world.deps.callLogger.flushNow = async () => {
      if (!inFlightDone) {
        world.calls.push('callLogger.flushNow(noop — in flight)');
        return;
      }
      world.calls.push('callLogger.finalFlush');
    };
    world.deps.callLogger.settled = () =>
      new Promise<void>((resolve) => {
        world.calls.push('callLogger.settled');
        setTimeout(() => {
          inFlightDone = true;
          resolve();
        }, 60);
      });
    const exits: number[] = [];
    const uninstall = installShutdownHandlers(world.deps);
    try {
      await runWithPatchedExit(exits, async () => {
        process.emit('SIGTERM', 'SIGTERM');
        await waitFor(() => exits.length > 0, 2000);
      });
    } finally {
      uninstall();
    }

    expect(exits).to.deep.equal([0]);
    const iSettled = world.calls.indexOf('callLogger.settled');
    const iFinal = world.calls.indexOf('callLogger.finalFlush');
    const iEndPool = world.calls.indexOf('endPool');
    expect(iSettled).to.be.at.least(0);
    expect(iFinal).to.be.greaterThan(iSettled); // final drain waits for the in-flight insert
    expect(iEndPool).to.be.greaterThan(iFinal); // pool closes last
  });

  it('uninstall removes the signal handlers', () => {
    const world = makeWorld();
    const beforeTerm = process.listenerCount('SIGTERM');
    const beforeInt = process.listenerCount('SIGINT');
    const uninstall = installShutdownHandlers(world.deps);
    expect(process.listenerCount('SIGTERM')).to.equal(beforeTerm + 1);
    expect(process.listenerCount('SIGINT')).to.equal(beforeInt + 1);
    uninstall();
    expect(process.listenerCount('SIGTERM')).to.equal(beforeTerm);
    expect(process.listenerCount('SIGINT')).to.equal(beforeInt);
  });
});

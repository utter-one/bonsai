import 'reflect-metadata';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import {
  CircuitBreaker,
  DEFAULT_CIRCUIT_BREAKER_PARAMS,
  NON_COUNTING_ERROR_CODES,
  type CircuitBreakerParams,
} from '../../../src/services/monitoring/CircuitBreaker';
import { CircuitBreakerRegistry } from '../../../src/services/monitoring/CircuitBreakerRegistry';
import { CircuitOpenError } from '../../../src/errors';

/** Captures metric writes without touching the DB-backed registry. */
class FakeMetrics {
  counters: Record<string, number> = {};
  gauges: Record<string, number> = {};

  inc(name: string, labels?: Record<string, unknown>, value = 1): void {
    const key = `${name}|${JSON.stringify(labels ?? {})}`;
    this.counters[key] = (this.counters[key] ?? 0) + value;
  }

  setGauge(name: string, labels?: Record<string, unknown>, value?: number): void {
    const key = `${name}|${JSON.stringify(labels ?? {})}`;
    this.gauges[key] = value;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const LABELS = { provider_id: 'prov_cb' };
const opensKey = `circuit_opens_total|${JSON.stringify(LABELS)}`;
const skipsKey = `circuit_open_skips_total|${JSON.stringify(LABELS)}`;
const stateKey = `circuit_breaker_state|${JSON.stringify(LABELS)}`;

/** Fast params for state-machine tests (short window/cooldown). */
const FAST: CircuitBreakerParams = { failureThreshold: 5, windowMs: 200, cooldownMs: 120 };

describe('CircuitBreaker (P3-01)', () => {
  let metrics: FakeMetrics;
  let breaker: CircuitBreaker;

  beforeEach(() => {
    metrics = new FakeMetrics();
    breaker = new CircuitBreaker('prov_cb', () => FAST, metrics as never);
  });

  describe('closed → open', () => {
    it('stays closed below the threshold', () => {
      for (let i = 0; i < 4; i++) breaker.recordFailure('server_error');
      expect(breaker.currentState).to.equal('closed');
      expect(() => breaker.beforeCall()).to.not.throw();
    });

    it('opens on the 5th qualifying failure within the window', () => {
      for (let i = 0; i < 5; i++) breaker.recordFailure('server_error');
      expect(breaker.currentState).to.equal('open');
      expect(metrics.counters[opensKey]).to.equal(1);
      expect(metrics.gauges[stateKey]).to.equal(1);
    });

    it('counts each qualifying error code: timeout, network, rate_limited, unknown (null)', () => {
      breaker.recordFailure('timeout');
      breaker.recordFailure('network');
      breaker.recordFailure('rate_limited');
      breaker.recordFailure(null); // unknown — counts conservatively
      expect(breaker.currentState).to.equal('closed');
      breaker.recordFailure('server_error');
      expect(breaker.currentState).to.equal('open');
    });

    it('never opens on auth failures (any number)', () => {
      for (let i = 0; i < 20; i++) breaker.recordFailure('auth');
      expect(breaker.currentState).to.equal('closed');
      expect(metrics.counters[opensKey] ?? 0).to.equal(0);
    });

    it('never opens on client_error failures (any number)', () => {
      for (let i = 0; i < 20; i++) breaker.recordFailure('client_error');
      expect(breaker.currentState).to.equal('closed');
    });

    it('sliding window: failures older than windowMs do not count', async () => {
      for (let i = 0; i < 4; i++) breaker.recordFailure('server_error');
      await sleep(220); // 4 failures slide out of the 200ms window
      breaker.recordFailure('server_error');
      expect(breaker.currentState).to.equal('closed');
      breaker.recordFailure('server_error'); // only 2 inside the window now
      expect(breaker.currentState).to.equal('closed');
    });

    it('successes do not clear the failure window', () => {
      breaker.recordFailure('server_error');
      breaker.recordSuccess();
      breaker.recordFailure('server_error');
      breaker.recordSuccess();
      breaker.recordFailure('server_error');
      expect(breaker.currentState).to.equal('closed');
      breaker.recordFailure('server_error');
      breaker.recordFailure('server_error');
      expect(breaker.currentState).to.equal('open');
    });

    it('honours live param overrides from the config provider', () => {
      // threshold 2 via a params provider that changes mid-life
      let threshold = 5;
      const live = new CircuitBreaker('prov_cb', () => ({ ...FAST, failureThreshold: threshold }), metrics as never);
      live.recordFailure('server_error');
      threshold = 2;
      live.recordFailure('server_error');
      expect(live.currentState).to.equal('open');
    });
  });

  describe('open → half-open → closed', () => {
    const openIt = () => {
      for (let i = 0; i < 5; i++) breaker.recordFailure('server_error');
    };

    it('beforeCall throws CircuitOpenError while the cooldown runs and increments the skip counter', () => {
      openIt();
      expect(() => breaker.beforeCall()).to.throw(CircuitOpenError);
      expect(() => breaker.beforeCall()).to.throw(CircuitOpenError);
      expect(metrics.counters[skipsKey]).to.equal(2);
      expect(breaker.currentState).to.equal('open');
    });

    it('after the cooldown, beforeCall allows exactly one probe (half-open)', () => {
      openIt();
      return (async () => {
        await sleep(130);
        breaker.beforeCall(); // → half-open, probe allowed
        expect(breaker.currentState).to.equal('half-open');
        expect(metrics.gauges[stateKey]).to.equal(2);
        // second concurrent caller while the probe is in flight → treated as open
        expect(() => breaker.beforeCall()).to.throw(CircuitOpenError);
        expect(metrics.counters[skipsKey]).to.equal(1);
      })();
    });

    it('half-open probe success closes the breaker and resets the window', () => {
      openIt();
      return (async () => {
        await sleep(130);
        breaker.beforeCall();
        breaker.recordSuccess();
        expect(breaker.currentState).to.equal('closed');
        expect(metrics.gauges[stateKey]).to.equal(0);
        // window reset: 4 more failures stay closed
        for (let i = 0; i < 4; i++) breaker.recordFailure('server_error');
        expect(breaker.currentState).to.equal('closed');
      })();
    });

    it('half-open probe failure reopens the breaker and restarts the cooldown', () => {
      openIt();
      return (async () => {
        await sleep(130);
        breaker.beforeCall(); // half-open
        breaker.recordFailure('server_error'); // probe failed
        expect(breaker.currentState).to.equal('open');
        expect(metrics.counters[opensKey]).to.equal(2);
        expect(metrics.gauges[stateKey]).to.equal(1);
        expect(() => breaker.beforeCall()).to.throw(CircuitOpenError); // cooldown restarted
      })();
    });

    it('results arriving while open (in-flight from before) do not extend the cooldown', () => {
      openIt();
      breaker.recordFailure('server_error'); // in-flight failure
      breaker.recordSuccess(); // in-flight success
      return (async () => {
        await sleep(130);
        breaker.beforeCall(); // cooldown elapsed on time → half-open
        expect(breaker.currentState).to.equal('half-open');
      })();
    });
  });

  describe('snapshot', () => {
    it('reports state, failuresInWindow and lastStateChangeAt while closed', () => {
      breaker.recordFailure('server_error');
      const snap = breaker.snapshot();
      expect(snap.state).to.equal('closed');
      expect(snap.failuresInWindow).to.equal(1);
      expect(snap.opensInLast24h).to.equal(0);
      expect(snap.lastStateChangeAt).to.be.an.instanceOf(Date);
      expect(Date.now() - snap.lastStateChangeAt.getTime()).to.be.lessThan(5000);
    });

    it('reports open state with windowed failure count and opensInLast24h', () => {
      for (let i = 0; i < 7; i++) breaker.recordFailure('server_error');
      const snap = breaker.snapshot();
      expect(snap.state).to.equal('open');
      // opens on the 5th; failures 6–7 arrive while open and are ignored
      expect(snap.failuresInWindow).to.equal(5);
      expect(snap.opensInLast24h).to.equal(1);
    });
  });

  describe('metrics', () => {
    it('sets circuit_breaker_state=0 at creation (explicit closed series)', () => {
      expect(metrics.gauges[stateKey]).to.equal(0);
    });

    it('increments circuit_opens_total per closed→open transition', () => {
      for (let i = 0; i < 5; i++) breaker.recordFailure('server_error');
      expect(metrics.counters[opensKey]).to.equal(1);
    });
  });

  describe('counting rules (module constants)', () => {
    it('excludes exactly auth and client_error', () => {
      expect([...NON_COUNTING_ERROR_CODES].sort()).to.deep.equal(['auth', 'client_error']);
      expect(DEFAULT_CIRCUIT_BREAKER_PARAMS).to.deep.equal({ failureThreshold: 5, windowMs: 60_000, cooldownMs: 300_000 });
    });
  });
});

describe('CircuitBreakerRegistry (P3-01)', () => {
  let metrics: FakeMetrics;
  let registry: CircuitBreakerRegistry;

  beforeEach(() => {
    metrics = new FakeMetrics();
    registry = new CircuitBreakerRegistry(metrics as never);
  });

  it('creates breakers lazily and reports null state for unknown providers', () => {
    expect(registry.getState('prov_x')).to.equal(null);
    expect(registry.snapshot()).to.deep.equal({});
    registry.recordFailure('prov_x', 'network');
    expect(registry.getState('prov_x')).to.equal('closed');
  });

  it('opens a breaker via 5 recordFailure calls and exposes the snapshot', () => {
    for (let i = 0; i < 5; i++) registry.recordFailure('prov_y', 'timeout');
    expect(registry.getState('prov_y')).to.equal('open');
    const snap = registry.snapshot();
    expect(snap['prov_y'].state).to.equal('open');
    expect(snap['prov_y'].failuresInWindow).to.equal(5);
    expect(snap['prov_y'].opensInLast24h).to.equal(1);
  });

  it('applies pushed monitoring_config overrides live (threshold 2 opens on 2 failures)', () => {
    registry.setParamsOverride({ failureThreshold: 2, windowMs: 60_000, cooldownMs: 300_000 });
    registry.recordFailure('prov_z', 'server_error');
    expect(registry.getState('prov_z')).to.equal('closed');
    registry.recordFailure('prov_z', 'server_error');
    expect(registry.getState('prov_z')).to.equal('open');
  });

  it('applies overrides to already-existing breakers on the next check', () => {
    registry.recordFailure('prov_w', 'server_error'); // breaker created with defaults (threshold 5)
    expect(registry.getState('prov_w')).to.equal('closed');
    registry.setParamsOverride({ failureThreshold: 2, windowMs: 60_000, cooldownMs: 300_000 });
    registry.recordFailure('prov_w', 'server_error');
    expect(registry.getState('prov_w')).to.equal('open');
  });

  it('falls back to defaults when no config has been pushed yet', () => {
    for (let i = 0; i < 4; i++) registry.recordFailure('prov_d', 'server_error');
    expect(registry.getState('prov_d')).to.equal('closed');
    registry.recordFailure('prov_d', 'server_error');
    expect(registry.getState('prov_d')).to.equal('open');
  });

  it('setParamsOverride(null) clears back to the defaults', () => {
    registry.setParamsOverride({ failureThreshold: 2 });
    registry.setParamsOverride(null);
    registry.recordFailure('prov_c', 'server_error');
    registry.recordFailure('prov_c', 'server_error');
    expect(registry.getState('prov_c')).to.equal('closed'); // threshold back to 5
  });

  it('getBreaker returns the same instance on repeat calls', () => {
    expect(registry.getBreaker('prov_same')).to.equal(registry.getBreaker('prov_same'));
  });

  it('beforeCall on an open breaker throws CircuitOpenError through the registry instance', () => {
    for (let i = 0; i < 5; i++) registry.recordFailure('prov_t', 'network');
    const breaker = registry.getBreaker('prov_t');
    expect(() => breaker.beforeCall()).to.throw(CircuitOpenError);
  });
});

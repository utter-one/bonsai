import { describe, it } from 'mocha';
import { expect } from 'chai';
import { HeartbeatRegistry } from '../../../src/services/monitoring/HeartbeatRegistry';
import { MetricsRegistry, type MetricSampleRow } from '../../../src/services/monitoring/MetricsRegistry';
import { MonitoringContext } from '../../../src/services/monitoring/MonitoringContext';

class QuietRegistry extends MetricsRegistry {
  protected async persistRows(rows: MetricSampleRow[]): Promise<void> {
    // no DB in unit tests
  }
  protected onFlushError(err: unknown): void {
    // swallow
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('HeartbeatRegistry (P1-02)', () => {
  it('tick() records lastRun and publishes the background_service_last_run_ts gauge', async () => {
    const registry = new QuietRegistry();
    const hb = new HeartbeatRegistry(registry);
    const before = Date.now();
    hb.tick('conversation-timeout');
    const after = Date.now();

    const last = hb.lastRun('conversation-timeout');
    expect(last).to.be.greaterThanOrEqual(before);
    expect(last).to.be.lessThanOrEqual(after);

    const snap = registry.snapshot(); // setGauge is synchronous
    expect(snap.gauges.background_service_last_run_ts?.['service=conversation-timeout']).to.equal(last);
  });

  it('tick() never throws even if the gauge publish fails', () => {
    const broken = { setGauge: () => { throw new Error('boom'); } } as unknown as MetricsRegistry;
    const hb = new HeartbeatRegistry(broken);
    expect(() => hb.tick('conversation-timeout')).to.not.throw();
  });

  it('recordError/errorCount accumulate per service', () => {
    const hb = new HeartbeatRegistry(new QuietRegistry());
    expect(hb.errorCount('imap')).to.equal(0);
    hb.recordError('imap');
    hb.recordError('imap');
    hb.recordError('oauth');
    expect(hb.errorCount('imap')).to.equal(2);
    expect(hb.errorCount('oauth')).to.equal(1);
  });

  it('staleServices() reports services older than maxAgeMs (never-ticked services excluded)', () => {
    const hb = new HeartbeatRegistry(new QuietRegistry());
    hb.tick('fresh');
    const now = Date.now();
    expect(hb.staleServices(60_000, now)).to.deep.equal([]);
    expect(hb.staleServices(0, now + 1)).to.deep.equal(['fresh']);
    expect(hb.staleServices(60_000, now + 61_000)).to.deep.equal(['fresh']);
    // never-ticked service is not "stale"
    expect(hb.staleServices(0, now + 10_000)).to.deep.equal(['fresh']);
  });
});

describe('MonitoringContext (P1-02)', () => {
  it('current() is undefined outside run()', () => {
    expect(MonitoringContext.current()).to.equal(undefined);
  });

  it('run() makes the context visible synchronously', () => {
    const result = MonitoringContext.run(
      { projectId: 'proj_x', conversationId: 'conv_y' },
      () => MonitoringContext.current(),
    );
    expect(result).to.deep.equal({ projectId: 'proj_x', conversationId: 'conv_y' });
  });

  it('propagates across await boundaries', async () => {
    const result = await MonitoringContext.run(
      { projectId: 'proj_async' },
      async () => {
        await sleep(1);
        return MonitoringContext.current()?.projectId;
      },
    );
    expect(result).to.equal('proj_async');
  });

  it('nested run() overrides and restores the outer context', async () => {
    const trace: (string | undefined)[] = [];
    await MonitoringContext.run(
      { projectId: 'outer' },
      async () => {
        trace.push(MonitoringContext.current()?.projectId);
        await MonitoringContext.run({ projectId: 'inner' }, () => {
          trace.push(MonitoringContext.current()?.projectId);
        });
        trace.push(MonitoringContext.current()?.projectId);
      },
    );
    expect(trace).to.deep.equal(['outer', 'inner', 'outer']);
  });
});

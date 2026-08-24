import { describe, it } from 'mocha';
import { expect } from 'chai';
import {
  MetricsRegistry,
  METRIC_CONFIGS,
  type MetricSampleRow,
} from '../../../src/services/monitoring/MetricsRegistry';

/** Test seam: captures rows instead of hitting the DB, counts flush errors. */
class CapturingRegistry extends MetricsRegistry {
  rows: any[] = [];
  flushErrors: unknown[] = [];
  failPersists = false;

  protected async persistRows(rows: MetricSampleRow[]): Promise<void> {
    if (this.failPersists) throw new Error('db down');
    this.rows.push(...rows);
  }

  protected onFlushError(err: unknown): void {
    this.flushErrors.push(err);
  }
}

describe('MetricsRegistry (P1-02)', () => {
  describe('record + snapshot', () => {
    it('inc() accumulates counter count and sum', () => {
      const reg = new CapturingRegistry();
      reg.inc('api_requests_total', { method: 'GET', route_group: 'test', status_class: '2xx' });
      reg.inc('api_requests_total', { method: 'GET', route_group: 'test', status_class: '2xx' }, 2);
      const snap = reg.snapshot();
      const series = snap.counters.api_requests_total['method=GET,route_group=test,status_class=2xx'];
      expect(series).to.deep.equal({ count: 3, sum: 3 });
    });

    it('observe() fills histogram buckets, min and max', () => {
      const reg = new CapturingRegistry();
      reg.observe('llm_ttft_ms', { provider_id: 'prov_a' }, 75);
      reg.observe('llm_ttft_ms', { provider_id: 'prov_a' }, 150);
      reg.observe('llm_ttft_ms', { provider_id: 'prov_a' }, 90_000); // +Inf bucket
      const snap = reg.snapshot();
      const h = snap.histograms.llm_ttft_ms['provider_id=prov_a'];
      // buckets [100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, +Inf]
      expect(h.count).to.equal(3);
      expect(h.sum).to.equal(90_225);
      expect(h.min).to.equal(75);
      expect(h.max).to.equal(90_000);
      expect(h.buckets).to.deep.equal([1, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    });

    it('setGauge() stores the latest value per series', () => {
      const reg = new CapturingRegistry();
      reg.setGauge('active_conversations', undefined, 3);
      reg.setGauge('active_conversations', undefined, 7);
      reg.setGauge('active_conversations', { scope: 'ws' }, 1);
      const snap = reg.snapshot();
      expect(snap.gauges.active_conversations['']).to.equal(7);
      expect(snap.gauges.active_conversations['scope=ws']).to.equal(1);
    });

    it('changeGauge() applies signed deltas (positive and negative) from many producers', () => {
      const reg = new CapturingRegistry();
      // producers add, then one leaves — the net must be the algebraic sum
      reg.changeGauge('active_conversations'); // +1 (default)
      reg.changeGauge('active_conversations', undefined, 2);
      reg.changeGauge('active_conversations', undefined, -1);
      reg.changeGauge('active_conversations', { scope: 'ws' }, 1);
      reg.changeGauge('active_conversations', { scope: 'ws' }, -1); // back to 0
      const snap = reg.snapshot();
      expect(snap.gauges.active_conversations['']).to.equal(2);
      expect(snap.gauges.active_conversations['scope=ws']).to.equal(0);
    });

    it('changeGauge() ignores non-finite deltas', () => {
      const reg = new CapturingRegistry();
      reg.changeGauge('active_conversations', undefined, Number.NaN);
      reg.changeGauge('active_conversations', undefined, Number.POSITIVE_INFINITY);
      const snap = reg.snapshot();
      expect(snap.gauges.active_conversations).to.equal(undefined);
    });

    it('snapshot() returns deep copies — mutating it does not affect the registry', () => {
      const reg = new CapturingRegistry();
      reg.inc('api_requests_total');
      const snap = reg.snapshot();
      snap.counters.api_requests_total[''].count = 999;
      expect(reg.snapshot().counters.api_requests_total[''].count).to.equal(1);
    });
  });

  describe('cardinality guard', () => {
    it('unknown metric name → dropped, never throws', () => {
      const reg = new CapturingRegistry();
      expect(() => reg.inc('not_a_metric')).to.not.throw();
      expect(() => reg.setGauge('not_a_metric', {}, 1)).to.not.throw();
      expect(() => reg.observe('not_a_metric', {}, 1)).to.not.throw();
      expect(reg.snapshot()).to.deep.equal({ counters: {}, gauges: {}, histograms: {} });
    });

    it('wrong-kind operation → dropped', () => {
      const reg = new CapturingRegistry();
      reg.inc('active_conversations'); // gauge
      reg.observe('api_requests_total', {}, 10); // counter
      reg.setGauge('llm_ttft_ms', {}, 5); // histogram
      expect(reg.snapshot()).to.deep.equal({ counters: {}, gauges: {}, histograms: {} });
    });

    it('label key outside the allowlist → series dropped', () => {
      const reg = new CapturingRegistry();
      reg.inc('api_requests_total', { method: 'GET', conversation_id: 'conv_x' });
      expect(reg.snapshot().counters.api_requests_total ?? {}).to.deep.equal({});
    });

    it('null/undefined label values are ignored', () => {
      const reg = new CapturingRegistry();
      reg.inc('api_requests_total', { method: 'GET', route_group: null, status_class: undefined });
      expect(reg.snapshot().counters.api_requests_total['method=GET']).to.exist;
    });

    it('series cap: new label-sets beyond maxSeries are dropped', () => {
      const reg = new CapturingRegistry();
      // background_service_last_run_ts: maxSeries 500
      for (let i = 0; i < 500; i++) reg.setGauge('background_service_last_run_ts', { service: `svc_${i}` }, Date.now());
      reg.setGauge('background_service_last_run_ts', { service: 'svc_overflow' }, Date.now());
      const snap = reg.snapshot();
      const series = snap.gauges.background_service_last_run_ts;
      expect(Object.keys(series).length).to.equal(500);
      expect(series['service=svc_overflow']).to.be.undefined;
    });

    it('route_group value cap: values beyond 200 map to other', () => {
      const reg = new CapturingRegistry();
      for (let i = 0; i < 201; i++) {
        reg.inc('api_requests_total', { method: 'GET', route_group: `route_${i}`, status_class: '2xx' });
      }
      const snap = reg.snapshot();
      const series = snap.counters.api_requests_total;
      const keys = Object.keys(series);
      // 200 distinct routes (the app has 152 patterns — cap raised in P1-04) + one 'other' series (route_200 overflowed into it)
      expect(keys.length).to.equal(201);
      expect(series['method=GET,route_group=other,status_class=2xx']).to.deep.equal({ count: 1, sum: 1 });
    });

    it('NaN values are dropped', () => {
      const reg = new CapturingRegistry();
      reg.inc('api_requests_total', undefined, NaN);
      reg.observe('llm_ttft_ms', undefined, NaN);
      reg.setGauge('active_conversations', undefined, NaN);
      expect(reg.snapshot()).to.deep.equal({ counters: {}, gauges: {}, histograms: {} });
    });
  });

  describe('flushNow()', () => {
    it('writes counter deltas, histogram windows and gauge levels as metric_samples rows', async () => {
      const reg = new CapturingRegistry();
      reg.inc('api_requests_total', { method: 'GET', route_group: 'r', status_class: '2xx' }, 3);
      reg.observe('llm_ttft_ms', { provider_id: 'prov_a' }, 75);
      reg.observe('llm_ttft_ms', { provider_id: 'prov_a' }, 150);
      reg.setGauge('active_conversations', undefined, 4);
      await reg.flushNow();

      expect(reg.rows.length).to.equal(3);
      const byName = new Map(reg.rows.map((r) => [r.name, r] as const));

      const counter = byName.get('api_requests_total')!;
      expect(counter.count).to.equal(3);
      expect(counter.sum).to.equal(3);
      expect(counter.min).to.equal(null);
      expect(counter.max).to.equal(null);
      expect(counter.labels).to.deep.equal({ method: 'GET', route_group: 'r', status_class: '2xx' });
      expect(counter.bucket).to.be.instanceOf(Date);
      expect(counter.id).to.match(/^msmp_/);

      const histogram = byName.get('llm_ttft_ms')!;
      expect(histogram.count).to.equal(2);
      expect(histogram.sum).to.equal(225);
      expect(histogram.min).to.equal(75);
      expect(histogram.max).to.equal(150);

      const gauge = byName.get('active_conversations')!;
      expect(gauge.count).to.equal(1);
      expect(gauge.sum).to.equal(4);
      expect(gauge.min).to.equal(4);
      expect(gauge.max).to.equal(4);
    });

    it('second flush with no changes writes nothing', async () => {
      const reg = new CapturingRegistry();
      reg.inc('api_requests_total');
      await reg.flushNow();
      const afterFirst = reg.rows.length;
      await reg.flushNow();
      expect(reg.rows.length).to.equal(afterFirst);
    });

    it('flushes counter deltas (not totals) across flushes', async () => {
      const reg = new CapturingRegistry();
      reg.inc('api_requests_total');
      await reg.flushNow();
      reg.inc('api_requests_total', undefined, 2);
      await reg.flushNow();
      const rows = reg.rows.filter((r) => r.name === 'api_requests_total');
      expect(rows.length).to.equal(2);
      expect(rows[0].count).to.equal(1);
      expect(rows[1].count).to.equal(2);
    });

    it('unchanged gauges are skipped; changed gauges write a level row', async () => {
      const reg = new CapturingRegistry();
      reg.setGauge('active_conversations', undefined, 2);
      await reg.flushNow();
      await reg.flushNow(); // same value → nothing
      expect(reg.rows.length).to.equal(1);
      reg.setGauge('active_conversations', undefined, 5);
      await reg.flushNow();
      expect(reg.rows.length).to.equal(2);
      expect(reg.rows[1].sum).to.equal(5);
    });

    it('persist failure: rows kept in memory, exactly one error reported, retried next flush', async () => {
      const reg = new CapturingRegistry();
      reg.inc('api_requests_total', undefined, 3);
      reg.observe('llm_ttft_ms', { provider_id: 'prov_a' }, 100);
      reg.setGauge('active_conversations', undefined, 1);

      reg.failPersists = true;
      await reg.flushNow(); // must not throw
      expect(reg.flushErrors.length).to.equal(1);
      expect(reg.lastFlushError).to.be.instanceOf(Error);
      expect(reg.rows.length).to.equal(0);
      // state unchanged — full deltas still pending
      expect(reg.snapshot().counters.api_requests_total[''].count).to.equal(3);

      reg.failPersists = false;
      await reg.flushNow();
      expect(reg.rows.length).to.equal(3);
      expect(reg.flushErrors.length).to.equal(1); // still exactly one error total
    });

    it('concurrent flushNow() calls do not double-flush', async () => {
      const reg = new CapturingRegistry();
      reg.inc('api_requests_total');
      await Promise.all([reg.flushNow(), reg.flushNow()]);
      expect(reg.rows.length).to.equal(1);
    });
  });

  it('METRIC_CONFIGS is closed and covers the Phase-1 metric surface', () => {
    const names = Object.keys(METRIC_CONFIGS).sort();
    expect(names).to.include.members([
      'api_requests_total',
      'api_request_duration_ms',
      'provider_calls_total',
      'provider_call_duration_ms',
      'active_conversations',
      'active_websocket_connections',
      'db_pool_total',
      'db_pool_idle',
      'db_pool_waiting',
      'rss_bytes',
      'event_loop_lag_p95_ms',
      'circuit_breaker_state',
      'circuit_opens_total',
      'circuit_open_skips_total',
      'fallback_attempts_total',
      'fallbacks_executed_total',
      'provider_chain_exhausted_total',
      'fallback_incompatible_total',
      'background_service_last_run_ts',
      'rate_limit_rejections_total',
      'oauth_refresh_total',
      'imap_poll_total',
      'llm_ttft_ms',
      'llm_stream_duration_ms',
      'tts_ttfa_ms',
      'tts_synthesis_ms',
      'asr_setup_ms',
      'asr_eos_to_final_ms',
      'ai_turn_ttft_ms',
    ]);
    for (const [name, cfg] of Object.entries(METRIC_CONFIGS)) {
      if (cfg.kind === 'histogram') {
        expect(cfg.buckets?.length, `histogram ${name} needs buckets`).to.be.greaterThan(0);
      }
    }
  });
});

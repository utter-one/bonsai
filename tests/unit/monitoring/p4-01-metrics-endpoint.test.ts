import 'reflect-metadata';
import { describe, it, afterEach } from 'mocha';
import { expect } from 'chai';
import {
  createMetricsHandler,
  renderPrometheusExposition,
  sanitizeName,
  escapeLabelValue,
  AuthFailureThrottle,
  METRICS_CONTENT_TYPE,
  METRICS_TOKEN_ENV,
} from '../../../src/http/middleware/metricsEndpoint';
import type { MetricsSnapshot } from '../../../src/services/monitoring/MetricsRegistry';

// --- rendering helpers ---

const processStats = { uptimeSeconds: 1234.5, residentMemoryBytes: 65536 };

function fixtureSnapshot(): MetricsSnapshot {
  return {
    counters: {
      provider_calls_total: {
        '': { count: 2, sum: 2 },
        'ok=true,operation=llm': { count: 7, sum: 7 },
      },
    },
    gauges: {
      active_conversations: {
        'project_id=p1': 3,
      },
      zeta_gauge: {
        'a=1': 3,
        'a=2': 4,
      },
    },
    histograms: {
      asr_eos_to_final_ms: {
        'provider_id=prov1': {
          count: 3,
          sum: 2905,
          min: 5,
          max: 2600,
          // boundaries [250, 500, 1000, 2500, 5000, 10000, 30000] → 8 buckets: values 5, 300, 2600
          buckets: [1, 1, 0, 0, 1, 0, 0, 0],
        },
      },
    },
  };
}

function makeRes(): any {
  const res: any = {
    statusCode: null,
    body: undefined,
    headers: {} as Record<string, string>,
    ended: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    set(key: string, value: string) {
      this.headers[key] = value;
      return this;
    },
    json(obj: unknown) {
      this.body = obj;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
    send(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res;
}

function makeReq(headers: Record<string, string> = {}): any {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    path: '/metrics',
    ip: '10.0.0.1',
    get: (name: string) => lower[name.toLowerCase()],
  };
}

describe('p4-01: prometheus metrics endpoint', () => {
  afterEach(() => {
    delete process.env[METRICS_TOKEN_ENV];
  });

  describe('renderPrometheusExposition', () => {
    it('renders HELP/TYPE lines and all metric kinds, sorted by name', () => {
      const out = renderPrometheusExposition(fixtureSnapshot(), processStats);
      const lines = out.split('\n');

      expect(lines).to.include('# HELP active_conversations Number of currently active conversations.');
      expect(lines).to.include('# TYPE active_conversations gauge');
      expect(lines).to.include('# TYPE asr_eos_to_final_ms histogram');
      expect(lines).to.include('# TYPE provider_calls_total counter');
      expect(lines).to.include('# HELP process_uptime_seconds Process uptime in seconds.');
      expect(lines).to.include('# TYPE process_uptime_seconds gauge');
      expect(lines).to.include('# TYPE process_resident_memory_bytes gauge');

      // Deterministic: identical input → identical output
      expect(renderPrometheusExposition(fixtureSnapshot(), processStats)).to.equal(out);
    });

    it('renders counter series (with and without labels) sorted', () => {
      const out = renderPrometheusExposition(fixtureSnapshot(), processStats);
      const lines = out.split('\n');
      const counterLines = lines.filter((l) => l.startsWith('provider_calls_total'));
      expect(counterLines).to.deep.equal([
        'provider_calls_total 2',
        'provider_calls_total{ok="true",operation="llm"} 7',
      ]);
    });

    it('renders gauges and always includes process gauges', () => {
      const out = renderPrometheusExposition(fixtureSnapshot(), processStats);
      const lines = out.split('\n');
      expect(lines).to.include('active_conversations{project_id="p1"} 3');
      expect(lines).to.include('zeta_gauge{a="1"} 3');
      expect(lines).to.include('zeta_gauge{a="2"} 4');
      expect(lines).to.include('process_uptime_seconds 1234.5');
      expect(lines).to.include('process_resident_memory_bytes 65536');
    });

    it('renders histograms as cumulative buckets with le=+Inf, _sum and _count', () => {
      const out = renderPrometheusExposition(fixtureSnapshot(), processStats);
      const lines = out.split('\n');
      const histLines = lines.filter((l) => l.startsWith('asr_eos_to_final_ms'));
      // boundaries [250, 500, 1000, 2500, 5000, 10000, 30000]; non-cumulative buckets [1,1,0,0,1,0,0,0]
      // → cumulative: 1, 2, 2, 2, 3, 3, 3, +Inf 3
      expect(histLines).to.deep.equal([
        'asr_eos_to_final_ms_bucket{provider_id="prov1",le="250"} 1',
        'asr_eos_to_final_ms_bucket{provider_id="prov1",le="500"} 2',
        'asr_eos_to_final_ms_bucket{provider_id="prov1",le="1000"} 2',
        'asr_eos_to_final_ms_bucket{provider_id="prov1",le="2500"} 2',
        'asr_eos_to_final_ms_bucket{provider_id="prov1",le="5000"} 3',
        'asr_eos_to_final_ms_bucket{provider_id="prov1",le="10000"} 3',
        'asr_eos_to_final_ms_bucket{provider_id="prov1",le="30000"} 3',
        'asr_eos_to_final_ms_bucket{provider_id="prov1",le="+Inf"} 3',
        'asr_eos_to_final_ms_sum{provider_id="prov1"} 2905',
        'asr_eos_to_final_ms_count{provider_id="prov1"} 3',
      ]);
    });

    it('escapes label values (backslash, quote, newline)', () => {
      const snapshot: MetricsSnapshot = {
        counters: {},
        gauges: {
          rate_limit_rejections_total: {
            'key_type=a"b\\c\nd': 1,
          },
        },
        histograms: {},
      };
      const out = renderPrometheusExposition(snapshot, processStats);
      expect(out.split('\n')).to.include('rate_limit_rejections_total{key_type="a\\"b\\\\c\\nd"} 1');
    });

    it('sanitizes metric and label names to the Prometheus charset', () => {
      const snapshot: MetricsSnapshot = {
        counters: {},
        gauges: {
          'weird-name.v2': {
            'label-key=x': 9,
          },
        },
        histograms: {},
      };
      const out = renderPrometheusExposition(snapshot, processStats);
      const lines = out.split('\n');
      expect(lines).to.include('# TYPE weird_name_v2 gauge');
      expect(lines).to.include('weird_name_v2{label_key="x"} 9');
    });

    it('sanitizes names: colon allowed, invalid chars replaced with underscore', () => {
      expect(sanitizeName('api:requests.v2')).to.equal('api:requests_v2');
      expect(sanitizeName('9lives')).to.equal('_lives');
      expect(escapeLabelValue('a"b\\c\nd')).to.equal('a\\"b\\\\c\\nd');
    });
  });

  describe('token gate', () => {
    it('returns 404 when the token env is unset (endpoint hidden)', () => {
      const handler = createMetricsHandler();
      const res = makeRes();
      handler(makeReq(), res);
      expect(res.statusCode).to.equal(404);
      expect(res.ended).to.equal(true);
    });

    it('returns 404 when the token env is an empty string', () => {
      process.env[METRICS_TOKEN_ENV] = '';
      const handler = createMetricsHandler();
      const res = makeRes();
      handler(makeReq(), res);
      expect(res.statusCode).to.equal(404);
    });

    it('returns 401 {error:unauthorized} when enabled but the token is missing', () => {
      process.env[METRICS_TOKEN_ENV] = 'sekret-token';
      const handler = createMetricsHandler();
      const res = makeRes();
      handler(makeReq(), res);
      expect(res.statusCode).to.equal(401);
      expect(res.body).to.deep.equal({ error: 'unauthorized' });
    });

    it('returns 401 for a wrong token', () => {
      process.env[METRICS_TOKEN_ENV] = 'sekret-token';
      const handler = createMetricsHandler();
      const res = makeRes();
      handler(makeReq({ Authorization: 'Bearer wrong-token' }), res);
      expect(res.statusCode).to.equal(401);
      expect(res.body).to.deep.equal({ error: 'unauthorized' });
    });

    it('returns 200 + text exposition with the correct token (scheme case-insensitive)', () => {
      process.env[METRICS_TOKEN_ENV] = 'sekret-token';
      const handler = createMetricsHandler();
      const res = makeRes();
      handler(makeReq({ authorization: 'bearer sekret-token' }), res);
      expect(res.statusCode).to.equal(200);
      expect(res.headers['Content-Type']).to.equal(METRICS_CONTENT_TYPE);
      expect(typeof res.body).to.equal('string');
      expect(res.body).to.include('# TYPE process_uptime_seconds gauge');
      expect(res.body).to.include('process_resident_memory_bytes');
    });
  });

  describe('AuthFailureThrottle', () => {
    it('allows at most maxPerWindow logs per window, then resets', () => {
      let now = 1_000_000;
      const throttle = new AuthFailureThrottle(60_000, 3, () => now);
      expect([throttle.allow(), throttle.allow(), throttle.allow()]).to.deep.equal([true, true, true]);
      expect(throttle.allow()).to.equal(false);
      expect(throttle.allow()).to.equal(false);

      now += 60_000; // next window: budget resets to maxPerWindow
      expect([throttle.allow(), throttle.allow(), throttle.allow()]).to.deep.equal([true, true, true]);
      expect(throttle.allow()).to.equal(false);
    });

    it('uses 10 logs per minute by default', () => {
      let now = 0;
      const throttle = new AuthFailureThrottle(undefined, undefined, () => now);
      let allowed = 0;
      for (let i = 0; i < 15; i++) {
        if (throttle.allow()) allowed++;
      }
      expect(allowed).to.equal(10);
    });
  });
});

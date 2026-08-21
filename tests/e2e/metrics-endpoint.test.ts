import { describe, it, afterEach, beforeEach } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import type { MetricsRegistry } from '../../src/services/monitoring/MetricsRegistry';

/**
 * P4-01 e2e — the three gate outcomes for GET /metrics via supertest.
 * The handler reads MONITORING_METRICS_TOKEN from process.env per request, so the
 * gate can be toggled per test without a second app instance.
 */

const TOKEN = 'e2e-metrics-scrape-token';

function app() {
  return (globalThis as any).__TEST_APP__;
}

function registry(): MetricsRegistry {
  return (globalThis as any).__TEST_METRICS_REGISTRY__;
}

function apiRequestsTotal(): number {
  const counters = registry().snapshot().counters['api_requests_total'] ?? {};
  return Object.values(counters).reduce((acc, s) => acc + s.count, 0);
}

describe('prometheus metrics endpoint (P4-01)', () => {
  beforeEach(() => {
    delete process.env.MONITORING_METRICS_TOKEN;
  });

  afterEach(() => {
    delete process.env.MONITORING_METRICS_TOKEN;
  });

  it('returns 404 when MONITORING_METRICS_TOKEN is unset', async () => {
    const res = await request(app()).get('/metrics');
    expect(res.status).to.equal(404);
  });

  it('returns 401 {error:unauthorized} without a token when enabled', async () => {
    process.env.MONITORING_METRICS_TOKEN = TOKEN;
    const res = await request(app()).get('/metrics');
    expect(res.status).to.equal(401);
    expect(res.body).to.deep.equal({ error: 'unauthorized' });
  });

  it('returns 401 for a wrong token', async () => {
    process.env.MONITORING_METRICS_TOKEN = TOKEN;
    const res = await request(app())
      .get('/metrics')
      .set('Authorization', 'Bearer not-the-token');
    expect(res.status).to.equal(401);
    expect(res.body).to.deep.equal({ error: 'unauthorized' });
  });

  it('returns 200 + text/plain; version=0.0.4 exposition with the correct token', async () => {
    process.env.MONITORING_METRICS_TOKEN = TOKEN;
    const res = await request(app())
      .get('/metrics')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).to.equal(200);
    // Express re-serializes the header (parameter order may change); assert type + both parameters
    const contentType = res.headers['content-type'] ?? '';
    expect(contentType).to.match(/^text\/plain/);
    expect(contentType).to.include('version=0.0.4');
    expect(contentType).to.include('charset=utf-8');
    expect(typeof res.text).to.equal('string');
    // Always-present process gauges + a TYPE line per rendered metric
    expect(res.text).to.include('# TYPE process_uptime_seconds gauge');
    expect(res.text).to.match(/^process_uptime_seconds \d+(\.\d+)?$/m);
    expect(res.text).to.include('# TYPE process_resident_memory_bytes gauge');
    // HELP lines come from the registry description map
    expect(res.text).to.include('# HELP process_uptime_seconds Process uptime in seconds.');

    // Structural determinism: every sample line is well-formed and metric names are
    // emitted in sorted order (a live registry's values keep moving, so full-text
    // equality across two scrapes is not asserted here — that is covered in unit tests).
    const sampleLines = res.text.split('\n').filter((l) => l.length > 0 && !l.startsWith('#'));
    expect(sampleLines.length).to.be.greaterThan(0);
    const baseName = (line: string): string => {
      const head = line.split(' ')[0];
      const bare = head.includes('{') ? head.slice(0, head.indexOf('{')) : head;
      return bare.replace(/_(bucket|sum|count)$/, '');
    };
    for (const line of sampleLines) {
      expect(line).to.match(/^[a-zA-Z_:][a-zA-Z0-9_:]*(\{[a-zA-Z0-9_:]+="[^"]*"(,[a-zA-Z0-9_:]+="[^"]*")*\})? -?\d+(\.\d+)?([eE][+-]?\d+)?$/);
    }
    const names = sampleLines.map(baseName);
    expect(names).to.deep.equal([...names].sort());
  });

  it('does not count /metrics traffic in api_requests_total or rate limits', async () => {
    process.env.MONITORING_METRICS_TOKEN = TOKEN;
    const before = apiRequestsTotal();
    const res = await request(app())
      .get('/metrics')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).to.equal(200);
    expect(apiRequestsTotal()).to.equal(before);
  });
});

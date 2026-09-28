import 'reflect-metadata';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, unauthed, resetDatabase } from '../utils';
import type { MetricsRegistry } from '../../src/services/monitoring/MetricsRegistry';

// The app's registry instance, exposed by tests/setup.ts. Test files load in a separate
// module graph from the app (mocha's tsx require hook), so their own tsyringe resolve
// would return a different MetricsRegistry singleton than the one the middleware uses.
function appRegistry(): MetricsRegistry {
  const registry = (globalThis as any).__TEST_METRICS_REGISTRY__ as MetricsRegistry | undefined;
  expect(registry).to.not.equal(undefined, '__TEST_METRICS_REGISTRY__ is not set — tests/setup.ts must expose the app-world registry');
  return registry;
}

describe('Request outcome (P1-04)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('echoes a generated X-Request-Id on API responses; ids are unique per request', async () => {
    const res1 = await authed().get('/api/profile').expect(200);
    const res2 = await authed().get('/api/profile').expect(200);
    const id1 = res1.headers['x-request-id'];
    const id2 = res2.headers['x-request-id'];
    expect(id1).to.be.a('string');
    expect(id1).to.match(/^req_[0-9a-f-]{36}$/);
    expect(id2).to.be.a('string');
    expect(id1).to.not.equal(id2);
  });

  it('honors an inbound X-Request-Id (echoed unchanged)', async () => {
    const res = await authed().get('/api/profile').set('X-Request-Id', 'e2e-client-id-1').expect(200);
    expect(res.headers['x-request-id']).to.equal('e2e-client-id-1');
  });

  it('sets X-Request-Id on 404 responses', async () => {
    const res = await unauthed().get('/api/definitely-not-a-route');
    expect(res.status).to.equal(404);
    expect(res.headers['x-request-id']).to.be.a('string');
  });

  it('records api_requests_total and api_request_duration_ms for 2xx and 4xx requests', async () => {
    await authed().get('/api/profile').expect(200);
    // multi-segment unmatched path so the first-two-segments fallback group is visible
    await unauthed().get('/api/nothing/at-all');

    const snap = appRegistry().snapshot();

    const okCounter = snap.counters.api_requests_total['method=GET,route_group=/api/profile,status_class=2xx'];
    expect(okCounter).to.not.equal(undefined);
    expect(okCounter.count).to.be.at.least(1);
    const okHist = snap.histograms.api_request_duration_ms['method=GET,route_group=/api/profile'];
    expect(okHist).to.not.equal(undefined);
    expect(okHist.count).to.be.at.least(1);

    // unmatched route → first-two-segments fallback group, 4xx class
    const notFoundCounter = snap.counters.api_requests_total['method=GET,route_group=/api/nothing,status_class=4xx'];
    expect(notFoundCounter).to.not.equal(undefined);
    expect(notFoundCounter.count).to.be.at.least(1);
  });
});

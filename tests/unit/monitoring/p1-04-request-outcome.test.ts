import 'reflect-metadata';
import { describe, it, before, beforeEach } from 'mocha';
import { expect } from 'chai';
import pino from 'pino';
import { Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { container } from 'tsyringe';
import {
  requestOutcomeMiddleware,
  isSkippedRequestPath,
  resolveRequestHeaderId,
  resolveOutcomeLevel,
  statusClass,
  resolveRouteGroup,
} from '../../../src/http/middleware/requestOutcome';
import { MetricsRegistry, type MetricSampleRow } from '../../../src/services/monitoring/MetricsRegistry';
import { resetMonitoringAccessorsForTests } from '../../../src/services/monitoring/ProviderCallRecorder';
import { LOG_REDACT, logger } from '../../../src/utils/logger';

/** Test seam: captures persisted rows instead of hitting the DB. */
class CapturingRegistry extends MetricsRegistry {
  rows: MetricSampleRow[] = [];

  protected async persistRows(rows: MetricSampleRow[]): Promise<void> {
    this.rows.push(...rows);
  }
}

function makeRes(status: number): any {
  const res = new EventEmitter() as any;
  res.statusCode = status;
  res.headers = {} as Record<string, string>;
  res.setHeader = (name: string, value: string) => {
    res.headers[name] = value;
  };
  return res;
}

function makeReq(overrides: Record<string, unknown> = {}): any {
  return {
    method: 'GET',
    path: '/',
    baseUrl: '',
    route: undefined,
    id: undefined,
    get: (_header: string) => undefined,
    ...overrides,
  };
}

describe('P1-04 request outcome middleware', () => {
  let capturing: CapturingRegistry;

  before(() => {
    logger.level = 'silent'; // keep unit-test stderr clean
  });

  beforeEach(() => {
    // fresh registry per test — the middleware reaches it via the cached
    // getMetricsRegistry() accessor, reset so it re-resolves from the container
    capturing = new CapturingRegistry();
    container.registerInstance(MetricsRegistry, capturing);
    resetMonitoringAccessorsForTests();
  });

  describe('pure helpers', () => {
    it('isSkippedRequestPath() skips only /health and /metrics exactly', () => {
      expect(isSkippedRequestPath('/health')).to.equal(true);
      expect(isSkippedRequestPath('/metrics')).to.equal(true);
      expect(isSkippedRequestPath('/api/conversations')).to.equal(false);
      expect(isSkippedRequestPath('/health/extra')).to.equal(false);
      expect(isSkippedRequestPath('/metrics2')).to.equal(false);
    });

    it('resolveOutcomeLevel(): 2xx/3xx → debug, 4xx → warn, 5xx → error', () => {
      expect(resolveOutcomeLevel(200)).to.equal('debug');
      expect(resolveOutcomeLevel(299)).to.equal('debug');
      expect(resolveOutcomeLevel(301)).to.equal('debug');
      expect(resolveOutcomeLevel(400)).to.equal('warn');
      expect(resolveOutcomeLevel(404)).to.equal('warn');
      expect(resolveOutcomeLevel(429)).to.equal('warn');
      expect(resolveOutcomeLevel(500)).to.equal('error');
      expect(resolveOutcomeLevel(503)).to.equal('error');
    });

    it('statusClass() buckets statuses and clamps out-of-range', () => {
      expect(statusClass(200)).to.equal('2xx');
      expect(statusClass(301)).to.equal('3xx');
      expect(statusClass(404)).to.equal('4xx');
      expect(statusClass(429)).to.equal('4xx');
      expect(statusClass(500)).to.equal('5xx');
      expect(statusClass(599)).to.equal('5xx');
      expect(statusClass(100)).to.equal('2xx'); // clamped up
      expect(statusClass(600)).to.equal('5xx'); // clamped down
    });

    it('resolveRequestHeaderId() honors sane inbound ids, generates house-style ids otherwise', () => {
      expect(resolveRequestHeaderId('client-id-123')).to.equal('client-id-123');
      expect(resolveRequestHeaderId('  padded  ')).to.equal('padded');
      expect(resolveRequestHeaderId('x'.repeat(128))).to.equal('x'.repeat(128)); // boundary kept
      expect(resolveRequestHeaderId('x'.repeat(129))).to.match(/^req_[0-9a-f-]{36}$/); // too long → generated
      expect(resolveRequestHeaderId(undefined)).to.match(/^req_[0-9a-f-]{36}$/);
      expect(resolveRequestHeaderId('   ')).to.match(/^req_[0-9a-f-]{36}$/);
    });

    it('resolveRouteGroup() uses the matched route pattern, else first two path segments', () => {
      expect(resolveRouteGroup(makeReq({ route: { path: '/api/conversations/:id' }, path: '/api/conversations/abc' }))).to.equal('/api/conversations/:id');
      expect(resolveRouteGroup(makeReq({ route: { path: '/x' }, baseUrl: '/api' }))).to.equal('/api/x');
      expect(resolveRouteGroup(makeReq({ path: '/api/conversations/abc/messages' }))).to.equal('/api/conversations');
      expect(resolveRouteGroup(makeReq({ path: '/health' }))).to.equal('/health');
      expect(resolveRouteGroup(makeReq({ path: '/' }))).to.equal('/');
    });
  });

  describe('middleware behaviour', () => {
    it('assigns req.id, echoes X-Request-Id, and records 2xx counter + histogram on finish', () => {
      const req = makeReq({ method: 'POST', path: '/api/conversations/abc', route: { path: '/api/conversations/:id' } });
      const res = makeRes(201);
      requestOutcomeMiddleware(req, res, () => {});
      expect(req.id).to.match(/^req_[0-9a-f-]{36}$/);
      expect(res.headers['X-Request-Id']).to.equal(req.id);

      res.emit('finish');
      const snap = capturing.snapshot();
      expect(snap.counters.api_requests_total['method=POST,route_group=/api/conversations/:id,status_class=2xx']).to.deep.equal({ count: 1, sum: 1 });
      const h = snap.histograms.api_request_duration_ms['method=POST,route_group=/api/conversations/:id'];
      expect(h.count).to.equal(1);
      expect(h.sum).to.be.at.least(0);
    });

    it('honors a sane inbound X-Request-Id (echoed unchanged)', () => {
      const req = makeReq({ get: (header: string) => (header === 'X-Request-Id' ? 'client-id-123' : undefined) });
      const res = makeRes(200);
      requestOutcomeMiddleware(req, res, () => {});
      expect(req.id).to.equal('client-id-123');
      expect(res.headers['X-Request-Id']).to.equal('client-id-123');
    });

    it('records a 5xx series for unmatched routes (404 fallback route_group)', () => {
      const req = makeReq({ method: 'GET', path: '/api/nonexistent/thing' });
      const res = makeRes(500);
      requestOutcomeMiddleware(req, res, () => {});
      res.emit('finish');
      const snap = capturing.snapshot();
      expect(snap.counters.api_requests_total['method=GET,route_group=/api/nonexistent,status_class=5xx']).to.deep.equal({ count: 1, sum: 1 });
    });

    it('records no metrics for skipped paths (still sets the header)', () => {
      const req = makeReq({ path: '/metrics' });
      const res = makeRes(200);
      requestOutcomeMiddleware(req, res, () => {});
      res.emit('finish');
      const snap = capturing.snapshot();
      expect(snap.counters.api_requests_total).to.equal(undefined);
      expect(snap.histograms.api_request_duration_ms).to.equal(undefined);
      expect(res.headers['X-Request-Id']).to.be.a('string');
    });
  });

  describe('pino redaction (LOG_REDACT)', () => {
    it('censors req/res authorization headers in captured pino output', async () => {
      let buf = '';
      const stream = new Writable({
        write(chunk, _enc, cb) {
          buf += chunk.toString();
          cb();
        },
      });
      const testLogger = pino({ level: 'info', redact: LOG_REDACT }, stream);
      testLogger.info({ req: { headers: { authorization: 'Bearer secret-token-xyz' } } }, 'probe');
      testLogger.info({ res: { headers: { authorization: 'Bearer secret-token-xyz' } } }, 'probe');
      await new Promise<void>((resolve) => testLogger.flush(resolve));
      testLogger.flush();

      const lines = buf.trim().split('\n').map((line) => JSON.parse(line));
      expect(lines.length).to.equal(2);
      expect(lines[0].req.headers.authorization).to.equal('[REDACTED]');
      expect(lines[1].res.headers.authorization).to.equal('[REDACTED]');
      expect(buf).to.not.contain('secret-token-xyz');
    });
  });
});

import 'reflect-metadata';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { container } from 'tsyringe';
import { resetDatabase } from '../utils';
import { db } from '../../src/db/index';
import { providerCallLogs, metricSamples } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { MetricsRegistry } from '../../src/services/monitoring/MetricsRegistry';
import { CallLogger } from '../../src/services/monitoring/CallLogger';

describe('Monitoring core (P1-02)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('MetricsRegistry → metric_samples', () => {
    it('flushNow() persists counter deltas, histogram windows and gauge levels', async () => {
      const registry = container.resolve(MetricsRegistry);

      registry.inc('api_requests_total', { method: 'GET', route_group: 'e2e', status_class: '2xx' }, 3);
      registry.observe('llm_ttft_ms', { provider_id: 'prov_e2e' }, 120);
      registry.observe('llm_ttft_ms', { provider_id: 'prov_e2e' }, 480);
      registry.setGauge('active_conversations', undefined, 4);

      await registry.flushNow();

      // Filter to this test's own (name, labels) series — other suites leave
      // in-memory series (e.g. circuit_breaker_state gauges) that this
      // flushNow() also persists.
      // Sorted-key series identity (jsonb key order is not guaranteed).
      const seriesKey = (r: { name: string; labels: Record<string, unknown> }) =>
        `${r.name}|${Object.keys(r.labels).sort().map((k) => `${k}=${String(r.labels[k])}`).join(',')}`;
      const own = new Set([
        'api_requests_total|method=GET,route_group=e2e,status_class=2xx',
        'llm_ttft_ms|provider_id=prov_e2e',
        'active_conversations|',
      ]);
      const rows = (await db.select().from(metricSamples)).filter((r) => own.has(seriesKey(r)));
      const byName = new Map(rows.map((r) => [r.name, r] as const));
      expect(byName.size).to.equal(3);

      const counter = byName.get('api_requests_total')!;
      expect(counter.count).to.equal(3);
      expect(counter.sum).to.equal(3);
      expect(counter.labels).to.deep.equal({ method: 'GET', route_group: 'e2e', status_class: '2xx' });

      const histogram = byName.get('llm_ttft_ms')!;
      expect(histogram.count).to.equal(2);
      expect(histogram.sum).to.equal(600);
      expect(histogram.min).to.equal(120);
      expect(histogram.max).to.equal(480);
      expect(histogram.labels).to.deep.equal({ provider_id: 'prov_e2e' });

      const gauge = byName.get('active_conversations')!;
      expect(gauge.count).to.equal(1);
      expect(gauge.sum).to.equal(4);
      expect(gauge.min).to.equal(4);
      expect(gauge.max).to.equal(4);

      // flush again with no changes — no new rows for our series
      await registry.flushNow();
      const after = (await db.select().from(metricSamples)).filter((r) => own.has(seriesKey(r)));
      expect(after.length).to.equal(rows.length);
    });
  });

  describe('CallLogger → provider_call_logs', () => {
    it('flushNow() persists rows including the metrics jsonb round-trip', async () => {
      const callLogger = container.resolve(CallLogger);

      callLogger.record({
        providerId: 'prov_e2e',
        providerType: 'llm',
        apiType: 'openai',
        operation: 'llm.generate',
        model: 'gpt-x',
        projectId: 'proj_e2e',
        conversationId: 'conv_e2e',
        ok: true,
        durationMs: 1500,
        metrics: { ttftMs: 123, chunksCount: 5, maxChunkGapMs: 80, tokensPrompt: 100, tokensCompletion: 50, finishReason: 'stop' },
      });
      callLogger.record({
        providerId: 'prov_e2e',
        providerType: 'llm',
        apiType: 'openai',
        operation: 'llm.generate',
        ok: false,
        errorCode: 'rate_limited',
        statusHttp: 429,
        durationMs: 30,
        errorText: 'Rate limit reached',
        metrics: { errorPhase: 'setup' },
      });

      await callLogger.flushNow();

      const rows = await db
        .select()
        .from(providerCallLogs)
        .where(eq(providerCallLogs.providerId, 'prov_e2e'));

      expect(rows.length).to.equal(2);
      // createdAt can share a millisecond within one batch — match by content, not order
      const okRow = rows.find((r) => r.ok && r.errorCode === null)!
      const errRow = rows.find((r) => r.errorCode === 'rate_limited')!
      expect(okRow).to.exist;
      expect(errRow).to.exist;

      expect(okRow.id).to.match(/^clgl_/);
      expect(okRow.ok).to.equal(true);
      expect(okRow.providerType).to.equal('llm');
      expect(okRow.apiType).to.equal('openai');
      expect(okRow.operation).to.equal('llm.generate');
      expect(okRow.model).to.equal('gpt-x');
      expect(okRow.projectId).to.equal('proj_e2e');
      expect(okRow.conversationId).to.equal('conv_e2e');
      expect(okRow.durationMs).to.equal(1500);
      expect(okRow.metrics).to.deep.equal({
        ttftMs: 123,
        chunksCount: 5,
        maxChunkGapMs: 80,
        tokensPrompt: 100,
        tokensCompletion: 50,
        finishReason: 'stop',
      });

      expect(errRow.ok).to.equal(false);
      expect(errRow.errorCode).to.equal('rate_limited');
      expect(errRow.statusHttp).to.equal(429);
      expect(errRow.errorText).to.equal('Rate limit reached');
      expect(errRow.metrics).to.deep.equal({ errorPhase: 'setup' });
    });

    it('flush failure keeps rows buffered (re-queued) and the next flush succeeds', async () => {
      const callLogger = container.resolve(CallLogger);

      callLogger.record({
        providerId: 'prov_e2e_fail',
        providerType: 'tts',
        apiType: 'elevenlabs',
        operation: 'tts.synthesize',
        ok: true,
        durationMs: 10,
      });

      // simulate a DB failure via the test seam
      const originalPersist = (callLogger as any).persistRows.bind(callLogger);
      (callLogger as any).persistRows = async () => {
        throw new Error('simulated db down');
      };
      await callLogger.flushNow(); // must not throw
      expect((callLogger as any).lastFlushError).to.be.instanceOf(Error);

      (callLogger as any).persistRows = originalPersist;
      await callLogger.flushNow();

      const rows = await db
        .select()
        .from(providerCallLogs)
        .where(eq(providerCallLogs.providerId, 'prov_e2e_fail'));
      expect(rows.length).to.equal(1);
      expect(rows[0].operation).to.equal('tts.synthesize');
    });
  });
});

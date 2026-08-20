import 'reflect-metadata';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { resetDatabase } from '../utils';
import { container } from 'tsyringe';
import { db } from '../../src/db/index';
import { alertEvents, monitoringConfig, providers } from '../../src/db/schema';
import { CallLogger } from '../../src/services/monitoring/CallLogger';
import { monitoringConfigSchema, type MonitoringConfig } from '../../src/http/contracts/monitoring';
import type { MonitoringConfigService } from '../../src/services/monitoring/MonitoringConfigService';
import type { AlertRuleEngine } from '../../src/services/monitoring/AlertRuleEngine';
import type { NotifyingPublisher } from '../../src/services/monitoring/notifiers/AlertNotifier';
import {
  EmailConnectionBase,
  type EmailAttachment,
} from '../../src/channels/email/shared/EmailConnectionBase';
import type { SessionManager } from '../../src/channels/SessionManager';

/**
 * P2-02 e2e — alert notifiers against the LIVE app (real DB, real engine at
 * 1 s, real NotifyingPublisher registered on ALERT_EVENT_PUBLISHER_TOKEN).
 *
 * Config is saved through the shared (singleton since P2-02)
 * MonitoringConfigService — the engine and the publisher read the very same
 * cache, so `save()` is picked up without the P2-01 engine seam. Webhook
 * delivery goes to a local HTTP receiver; email delivery goes through the
 * EmailNotifier connection-builder seam (finding 8) — the providers row read,
 * secret resolution and schema validation still run for real.
 */

// ─── Test seams ──────────────────────────────────────────────────────────────

function configService(): MonitoringConfigService {
  const svc = (globalThis as any).__TEST_MONITORING_CONFIG__ as MonitoringConfigService | undefined;
  expect(svc).to.not.equal(undefined, '__TEST_MONITORING_CONFIG__ is not set — tests/setup.ts must expose the app-world config service');
  return svc;
}

function engine(): AlertRuleEngine {
  const svc = (globalThis as any).__TEST_ALERT_ENGINE__ as AlertRuleEngine | undefined;
  expect(svc).to.not.equal(undefined, '__TEST_ALERT_ENGINE__ is not set — tests/setup.ts must expose the app-world alert engine');
  return svc;
}

function publisher(): NotifyingPublisher {
  const p = (globalThis as any).__TEST_ALERT_PUBLISHER__ as NotifyingPublisher | undefined;
  expect(p).to.not.equal(undefined, '__TEST_ALERT_PUBLISHER__ is not set — tests/setup.ts must expose the app-world alert publisher');
  return p;
}

/** Save a full config through the shared singleton (version-chained). */
async function saveConfig(mutate: (base: MonitoringConfig) => MonitoringConfig): Promise<void> {
  const svc = configService();
  const base = await svc.get();
  const rows = await db.select().from(monitoringConfig).where(eq(monitoringConfig.id, 'global'));
  const version = rows[0]?.version ?? 1;
  await svc.save(mutate(base), version);
}

async function alertsFor(ruleId: string) {
  return db.select().from(alertEvents).where(eq(alertEvents.ruleId, ruleId));
}

/** Poll an async predicate until it returns a value (fire-and-forget publisher). */
async function waitFor<T>(what: string, fn: () => Promise<T | undefined>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// ─── Webhook receiver ────────────────────────────────────────────────────────

type Received = { path: string; method: string; headers: http.IncomingHttpHeaders; body: unknown };

async function startReceiver(status: number): Promise<{
  url: (path: string) => string;
  received: Received[];
  close: () => Promise<void>;
}> {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      received.push({
        path: req.url ?? '',
        method: req.method ?? '',
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: (path: string) => `http://127.0.0.1:${port}${path}`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ─── Fake email connection (e2e send seam) ───────────────────────────────────

class FakeEmailConnection extends EmailConnectionBase {
  readonly connectionType = 'sendgrid' as const;
  readonly sent: Array<{ to: string; subject: string; body: string }> = [];

  constructor() {
    super('from@fake.test', 'messageId', {} as SessionManager, 'sendgrid', undefined);
  }

  protected getRecipientAddress(): string {
    return 'from@fake.test';
  }

  protected getChannelLabel(): string {
    return 'fake';
  }

  protected async doSendEmail(to: string, subject: string, body: string, _attachments: EmailAttachment[]): Promise<void> {
    this.sent.push({ to, subject, body });
  }
}

// ─── Rule helpers ────────────────────────────────────────────────────────────

// cooldownMinutes: 0 — the engine's in-memory state persists across tests in
// one process, and the 15 min default cooldown would block re-fires here.
const HIGH_MEMORY_FIRE = { threshold: 1, forMinutes: 0, resolveAfterGoodChecks: 1, cooldownMinutes: 0 };
const HIGH_MEMORY_RESOLVE = { threshold: 1024 * 1024 * 1024 * 1024, forMinutes: 0, resolveAfterGoodChecks: 1 };

describe('Alert notifiers (P2-02, e2e)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  after(async () => {
    // monitoring_config is intentionally NOT truncated by resetDatabase (like
    // operators — the global row persists across resets). Our notifier/rule
    // overrides must not leak into later suites: P1-06's first-boot test
    // asserts the synthesized defaults (notifiers [] etc.).
    const svc = configService();
    const rows = await db.select().from(monitoringConfig).where(eq(monitoringConfig.id, 'global'));
    await svc.save(monitoringConfigSchema.parse({}), rows[0]?.version ?? 1);
  });

  afterEach(async () => {
    publisher().emailNotifier.setConnectionBuilderForTests(null);
    engine().setConfigProviderForTests(null);
    // The engine's in-memory state machine survives resetDatabase(): if a test
    // ended with high-memory still firing, the next test's re-fire would be
    // suppressed (already firing). Best-effort resolve: raise the threshold
    // and run one pass so the key is back to 'resolved'.
    try {
      await saveConfig((base) => ({ ...base, rules: { ...base.rules, 'high-memory': HIGH_MEMORY_RESOLVE } }));
      await engine().runNow();
    } catch {
      // best effort — a later test that fails to fire is easier to diagnose than a hang here
    }
  });

  it('delivers fire and resolve to a webhook and records results on the alert row', async () => {
    const receiver = await startReceiver(200);
    try {
      await saveConfig((base) => ({
        ...base,
        notifiers: [{ id: 'notf_wh', type: 'webhook', url: receiver.url('/hook'), enabled: true }],
        rules: { ...base.rules, 'high-memory': HIGH_MEMORY_FIRE },
      }));

      await engine().runNow();
      const fired = await waitFor('firing high-memory alert', async () => {
        const rows = await alertsFor('high-memory');
        return rows.length === 1 && rows[0].status === 'firing' ? rows : undefined;
      });
      expect(fired[0].scopeKey).to.equal('high-memory:global');
      expect(fired[0].severity).to.equal('warning');
      expect(fired[0].message).to.contain('exceeds the');

      // Webhook delivery (publisher is fire-and-forget — poll the receiver)
      await waitFor('webhook delivery', async () => (receiver.received.length >= 1 ? receiver.received[0] : undefined));
      const call = receiver.received[0];
      expect(call.method).to.equal('POST');
      expect(call.path).to.equal('/hook');
      expect(call.headers['content-type']).to.equal('application/json');
      expect(call.headers['user-agent']).to.equal('bonsai-backend-monitoring/1.0');
      const body = call.body as Record<string, unknown>;
      expect(body.event).to.equal('alert_fired');
      expect(body.ruleId).to.equal('high-memory');
      expect(body.severity).to.equal('warning');
      expect(body.scopeKey).to.equal('high-memory:global');
      expect(body.message).to.contain('exceeds the');
      expect(body.context).to.have.property('rssBytes');
      expect(body.context).to.have.property('thresholdBytes');
      expect(body.firedAt).to.be.a('string');
      expect(body).to.not.have.property('resolvedAt');

      // Delivery result recorded on the alert row
      const withNotif = await waitFor('notification result', async () => {
        const rows = await alertsFor('high-memory');
        return rows[0].notifications.length === 1 ? rows[0] : undefined;
      });
      const notif = withNotif.notifications[0];
      expect(notif.notifierId).to.equal('notf_wh');
      expect(notif.phase).to.equal('fired');
      expect(notif.ok).to.equal(true);
      expect(notif.detail).to.equal(undefined);
      expect(notif.at).to.be.a('string');

      // Resolve: raise the threshold, next pass resolves + second delivery
      await saveConfig((base) => ({ ...base, rules: { ...base.rules, 'high-memory': HIGH_MEMORY_RESOLVE } }));
      await engine().runNow();
      const resolved = await waitFor('resolved high-memory alert', async () => {
        const rows = await alertsFor('high-memory');
        return rows.length === 1 && rows[0].status === 'resolved' ? rows : undefined;
      });
      expect(resolved[0].resolvedAt).to.not.equal(null);

      await waitFor('resolved webhook delivery', async () => (receiver.received.length >= 2 ? receiver.received[1] : undefined));
      const resolvedBody = receiver.received[1].body as Record<string, unknown>;
      expect(resolvedBody.event).to.equal('alert_resolved');
      expect(resolvedBody.resolvedAt).to.be.a('string');

      const finalRow = (await alertsFor('high-memory'))[0];
      expect(finalRow.notifications).to.have.length(2);
      expect(finalRow.notifications[1].phase).to.equal('resolved');
      expect(finalRow.notifications[1].ok).to.equal(true);
    } finally {
      await receiver.close();
    }
  });

  it('records a failed webhook delivery without affecting the alert row', async () => {
    const receiver = await startReceiver(500);
    try {
      await saveConfig((base) => ({
        ...base,
        notifiers: [{ id: 'notf_wh', type: 'webhook', url: receiver.url('/hook'), enabled: true }],
        rules: { ...base.rules, 'high-memory': HIGH_MEMORY_FIRE },
      }));

      await engine().runNow();
      const row = await waitFor('firing alert with recorded failure', async () => {
        const rows = await alertsFor('high-memory');
        return rows.length === 1 && rows[0].status === 'firing' && rows[0].notifications.length === 1 ? rows[0] : undefined;
      });
      expect(row.notifications[0].notifierId).to.equal('notf_wh');
      expect(row.notifications[0].phase).to.equal('fired');
      expect(row.notifications[0].ok).to.equal(false);
      expect(row.notifications[0].detail).to.equal('HTTP 500');
      expect(receiver.received).to.have.length(1);
    } finally {
      await receiver.close();
    }
  });

  it('respects the minSeverity floor: warning skips a critical-only notifier, critical delivers', async () => {
    const receiver = await startReceiver(200);
    try {
      await saveConfig((base) => ({
        ...base,
        notifiers: [{ id: 'notf_wh', type: 'webhook', url: receiver.url('/hook'), enabled: true, minSeverity: 'critical' }],
        rules: {
          ...base.rules,
          'high-memory': HIGH_MEMORY_FIRE,
          'provider-down': { forMinutes: 0, resolveAfterGoodChecks: 1, cooldownMinutes: 0 },
        },
      }));

      // Warning event fires but is below the floor — no delivery, no results
      await engine().runNow();
      const warning = await waitFor('firing warning alert', async () => {
        const rows = await alertsFor('high-memory');
        return rows.length === 1 && rows[0].status === 'firing' ? rows[0] : undefined;
      });
      expect(warning.severity).to.equal('warning');
      // Negative assertion: give the (non-existent) delivery a beat to land.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(receiver.received).to.have.length(0);
      expect((await alertsFor('high-memory'))[0].notifications).to.have.length(0);

      // Critical event (forced failing provider calls) crosses the floor
      const callLogger = container.resolve(CallLogger);
      for (let i = 0; i < 5; i++) {
        callLogger.record({
          providerId: 'prov_e2e_down',
          providerType: 'llm',
          apiType: 'openai',
          operation: 'llm.generate',
          ok: false,
          errorCode: 'unavailable',
          statusHttp: 500,
          durationMs: 1200,
          errorText: 'ECONNREFUSED',
        });
      }
      await callLogger.flushNow();

      await engine().runNow();
      const critical = await waitFor('firing critical alert with delivery', async () => {
        const rows = await alertsFor('provider-down');
        return rows.length === 1 && rows[0].status === 'firing' && rows[0].notifications.length === 1 ? rows[0] : undefined;
      });
      expect(critical.severity).to.equal('critical');
      expect(critical.notifications[0].ok).to.equal(true);

      // The app's background engine tick (1 s) can deliver unrelated
      // fire/resolve events to this receiver (its rules run against the
      // saved config) — assert on the provider-down delivery itself and on
      // the absence of the warning one, not on total delivery count.
      const down = await waitFor('webhook delivery for provider-down', async () =>
        receiver.received.find((m) => (m.body as Record<string, unknown>).ruleId === 'provider-down'),
      );
      const body = down.body as Record<string, unknown>;
      expect(body.ruleId).to.equal('provider-down');
      expect(body.severity).to.equal('critical');
      expect(receiver.received.some((m) => (m.body as Record<string, unknown>).ruleId === 'high-memory')).to.equal(false);
    } finally {
      await receiver.close();
    }
  });

  it('delivers email via a real channel provider row (send seam) and records the result', async () => {
    await db.insert(providers).values({
      id: 'prov_sg',
      name: 'SendGrid E2E',
      providerType: 'channel',
      apiType: 'sendgrid',
      config: { apiKey: 'SG.fake', fromAddress: 'alerts@fake.test', threadingStrategy: 'messageId' },
    });
    const conn = new FakeEmailConnection();
    publisher().emailNotifier.setConnectionBuilderForTests(() => conn);

    await saveConfig((base) => ({
      ...base,
      notifiers: [{ id: 'notf_email', type: 'email', channelProviderId: 'prov_sg', to: 'ops@fake.test', enabled: true }],
      rules: { ...base.rules, 'high-memory': HIGH_MEMORY_FIRE },
    }));

    await engine().runNow();
    const row = await waitFor('firing alert with email result', async () => {
      const rows = await alertsFor('high-memory');
      return rows.length === 1 && rows[0].notifications.length === 1 ? rows[0] : undefined;
    });

    // The engine may also deliver events for keys left over from previous
    // tests (e.g. provider-down resolving after the call rows were truncated)
    // — wait specifically for this test's high-memory email.
    const sent = await waitFor('high-memory email send', async () =>
      conn.sent.find((s) => s.subject.includes('high-memory')),
    );
    expect(sent.to).to.equal('ops@fake.test');
    expect(sent.subject).to.equal('[Bonsai][WARNING] high-memory — high-memory:global');
    expect(sent.body).to.contain('Bonsai alert fired');
    expect(sent.body).to.contain('exceeds the');
    expect(sent.body).to.contain('Rule: high-memory');

    expect(row.notifications[0].notifierId).to.equal('notf_email');
    expect(row.notifications[0].phase).to.equal('fired');
    expect(row.notifications[0].ok).to.equal(true);
  });

  it('records email delivery failure for a missing channel provider', async () => {
    await saveConfig((base) => ({
      ...base,
      notifiers: [{ id: 'notf_email', type: 'email', channelProviderId: 'prov_missing', to: 'ops@fake.test', enabled: true }],
      rules: { ...base.rules, 'high-memory': HIGH_MEMORY_FIRE },
    }));

    await engine().runNow();
    const row = await waitFor('firing alert with recorded email failure', async () => {
      const rows = await alertsFor('high-memory');
      return rows.length === 1 && rows[0].status === 'firing' && rows[0].notifications.length === 1 ? rows[0] : undefined;
    });
    expect(row.notifications[0].notifierId).to.equal('notf_email');
    expect(row.notifications[0].ok).to.equal(false);
    expect(row.notifications[0].detail).to.contain('channel provider not found: prov_missing');
  });
});

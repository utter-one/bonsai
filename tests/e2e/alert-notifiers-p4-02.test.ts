import 'reflect-metadata';
import { describe, it, beforeEach, after, afterEach } from 'mocha';
import { expect } from 'chai';
import { eq } from 'drizzle-orm';
import { authed, resetDatabase } from '../utils';
import { db } from '../../src/db/index';
import { alertEvents, monitoringConfig, providers } from '../../src/db/schema';
import { monitoringConfigSchema, type MonitoringConfig } from '../../src/http/contracts/monitoring';
import type { MonitoringConfigService } from '../../src/services/monitoring/MonitoringConfigService';
import type { AlertRuleEngine } from '../../src/services/monitoring/AlertRuleEngine';
import type { NotifyingPublisher } from '../../src/services/monitoring/notifiers/AlertNotifier';

/**
 * P4-02 e2e — telegram / twilio_sms / whatsapp alert notifiers against the
 * LIVE app (real DB, real engine at 1 s, real NotifyingPublisher on
 * ALERT_EVENT_PUBLISHER_TOKEN).
 *
 * Provider rows are REAL (providers table insert + secret resolution + schema
 * parse all run); the outbound send is captured through the notifier seams
 * (fetch / messages.create) — no network.
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

type FetchCall = { url: string; init: RequestInit };

// ─── Rule helpers ────────────────────────────────────────────────────────────

// cooldownMinutes: 0 — the engine's in-memory state persists across tests in
// one process, and the 15 min default cooldown would block re-fires here.
const HIGH_MEMORY_FIRE = { threshold: 1, forMinutes: 0, resolveAfterGoodChecks: 1, cooldownMinutes: 0 };
const HIGH_MEMORY_RESOLVE = { threshold: 1024 * 1024 * 1024 * 1024, forMinutes: 0, resolveAfterGoodChecks: 1 };

describe('Alert notifiers P4-02 (telegram / twilio_sms / whatsapp, e2e)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  after(async () => {
    // monitoring_config is intentionally NOT truncated by resetDatabase —
    // restore clean defaults so later suites see the synthesized config.
    const svc = configService();
    const rows = await db.select().from(monitoringConfig).where(eq(monitoringConfig.id, 'global'));
    await svc.save(monitoringConfigSchema.parse({}), rows[0]?.version ?? 1);
  });

  afterEach(async () => {
    publisher().channelNotifier.setFetchForTests(null);
    publisher().channelNotifier.setMessagesCreateForTests(null);
    // Best-effort resolve: drive the high-memory key back to resolved so the
    // next test can fire fresh (engine state survives resetDatabase()).
    try {
      await saveConfig((base) => ({ ...base, rules: { ...base.rules, 'high-memory': HIGH_MEMORY_RESOLVE } }));
      await engine().runNow();
    } catch {
      // best effort — a later test that fails to fire is easier to diagnose than a hang here
    }
  });

  it('delivers a fired alert to Telegram via a real channel provider row (fetch seam) and records ok', async () => {
    await db.insert(providers).values({
      id: 'prov_tg',
      name: 'Telegram E2E',
      providerType: 'channel',
      apiType: 'telegram',
      config: { botToken: '123456:FAKE-E2E-TOKEN' },
    });
    const calls: FetchCall[] = [];
    publisher().channelNotifier.setFetchForTests(async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true, result: { message: { chat: { id: '@ops-team' } } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await saveConfig((base) => ({
      ...base,
      notifiers: [{ id: 'notf_tg', type: 'telegram', channelProviderId: 'prov_tg', chatId: '@ops-team', enabled: true }],
      rules: { ...base.rules, 'high-memory': HIGH_MEMORY_FIRE },
    }));

    await engine().runNow();
    const row = await waitFor('firing alert with telegram result', async () => {
      const rows = await alertsFor('high-memory');
      return rows.length === 1 && rows[0].status === 'firing' && rows[0].notifications.length === 1 ? rows[0] : undefined;
    });
    expect(row.notifications[0].notifierId).to.equal('notf_tg');
    expect(row.notifications[0].phase).to.equal('fired');
    expect(row.notifications[0].ok).to.equal(true);

    const call = await waitFor('telegram send', async () => (calls.length >= 1 ? calls[0] : undefined));
    expect(call.url).to.equal('https://api.telegram.org/bot123456:FAKE-E2E-TOKEN/sendMessage');
    expect(call.init.method).to.equal('POST');
    const body = JSON.parse(call.init.body as string);
    expect(body.chat_id).to.equal('@ops-team');
    expect(body.text).to.contain('⚠️ Bonsai alert: high-memory — high-memory:global');
    expect(body.text).to.contain('exceeds the');
    expect(body).to.not.have.property('parse_mode');
  });

  it('delivers an SMS via a real twilio_messaging provider row (messages.create seam) and records ok', async () => {
    await db.insert(providers).values({
      id: 'prov_sms',
      name: 'Twilio SMS E2E',
      providerType: 'channel',
      apiType: 'twilio_messaging',
      config: { accountSid: 'AC1234567890', authToken: 'fake-auth-token', fromNumber: '+15550001111' },
    });
    const sent: Array<{ body: string; from: string; to: string }> = [];
    publisher().channelNotifier.setMessagesCreateForTests(async (params) => {
      sent.push(params);
    });

    await saveConfig((base) => ({
      ...base,
      notifiers: [{ id: 'notf_sms', type: 'twilio_sms', channelProviderId: 'prov_sms', to: '+48123456789', enabled: true }],
      rules: { ...base.rules, 'high-memory': HIGH_MEMORY_FIRE },
    }));

    await engine().runNow();
    const row = await waitFor('firing alert with sms result', async () => {
      const rows = await alertsFor('high-memory');
      return rows.length === 1 && rows[0].status === 'firing' && rows[0].notifications.length === 1 ? rows[0] : undefined;
    });
    expect(row.notifications[0].notifierId).to.equal('notf_sms');
    expect(row.notifications[0].phase).to.equal('fired');
    expect(row.notifications[0].ok).to.equal(true);

    const msg = await waitFor('sms send', async () => (sent.length >= 1 ? sent[0] : undefined));
    expect(msg.from).to.equal('+15550001111');
    expect(msg.to).to.equal('+48123456789');
    expect(msg.body).to.contain('⚠️ Bonsai alert: high-memory — high-memory:global');
    expect(msg.body).to.contain('exceeds the');
    expect(msg.body.length).to.be.at.most(320);
  });

  it('delivers a WhatsApp message via a real whatsapp provider row (fetch seam) and records ok', async () => {
    await db.insert(providers).values({
      id: 'prov_wa',
      name: 'WhatsApp E2E',
      providerType: 'channel',
      apiType: 'whatsapp',
      config: { phoneNumberId: '5550002222', accessToken: 'WA-E2E-TOKEN', appSecret: 'secret', verifyToken: 'vt' },
    });
    const calls: FetchCall[] = [];
    publisher().channelNotifier.setFetchForTests(async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.E2E' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await saveConfig((base) => ({
      ...base,
      notifiers: [{ id: 'notf_wa', type: 'whatsapp', channelProviderId: 'prov_wa', to: '+48123456789', enabled: true }],
      rules: { ...base.rules, 'high-memory': HIGH_MEMORY_FIRE },
    }));

    await engine().runNow();
    const row = await waitFor('firing alert with whatsapp result', async () => {
      const rows = await alertsFor('high-memory');
      return rows.length === 1 && rows[0].status === 'firing' && rows[0].notifications.length === 1 ? rows[0] : undefined;
    });
    expect(row.notifications[0].notifierId).to.equal('notf_wa');
    expect(row.notifications[0].phase).to.equal('fired');
    expect(row.notifications[0].ok).to.equal(true);

    const call = await waitFor('whatsapp send', async () => (calls.length >= 1 ? calls[0] : undefined));
    expect(call.url).to.equal('https://graph.facebook.com/v17.0/5550002222/messages');
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).to.equal('Bearer WA-E2E-TOKEN');
    const body = JSON.parse(call.init.body as string);
    expect(body.messaging_product).to.equal('whatsapp');
    expect(body.to).to.equal('+48123456789');
    expect(body.type).to.equal('text');
    expect(body.text.body).to.contain('⚠️ Bonsai alert: high-memory — high-memory:global');
  });

  it('delivers the resolved phase to Telegram with the resolved emoji and timestamps', async () => {
    await db.insert(providers).values({
      id: 'prov_tg',
      name: 'Telegram E2E',
      providerType: 'channel',
      apiType: 'telegram',
      config: { botToken: '123456:FAKE-E2E-TOKEN' },
    });
    const calls: FetchCall[] = [];
    publisher().channelNotifier.setFetchForTests(async (url, init) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    await saveConfig((base) => ({
      ...base,
      notifiers: [{ id: 'notf_tg', type: 'telegram', channelProviderId: 'prov_tg', chatId: '@ops-team', enabled: true }],
      rules: { ...base.rules, 'high-memory': HIGH_MEMORY_FIRE },
    }));

    await engine().runNow();
    await waitFor('firing alert (telegram)', async () => {
      const rows = await alertsFor('high-memory');
      return rows.length === 1 && rows[0].status === 'firing' ? rows : undefined;
    });

    // Resolve: raise the threshold, next pass resolves + second delivery.
    await saveConfig((base) => ({ ...base, rules: { ...base.rules, 'high-memory': HIGH_MEMORY_RESOLVE } }));
    await engine().runNow();
    const row = await waitFor('resolved alert with 2 telegram results', async () => {
      const rows = await alertsFor('high-memory');
      return rows.length === 1 && rows[0].status === 'resolved' && rows[0].notifications.length === 2 ? rows[0] : undefined;
    });
    expect(row.notifications[1].phase).to.equal('resolved');
    expect(row.notifications[1].ok).to.equal(true);

    const resolvedCall = await waitFor('resolved telegram send', async () => (calls.length >= 2 ? calls[1] : undefined));
    const body = JSON.parse(resolvedCall.init.body as string);
    expect(body.text).to.contain('✅ Bonsai resolved: high-memory — high-memory:global');
    expect(body.text).to.match(/fired: \d{4}-\d{2}-\d{2}T.*Z \/ resolved: \d{4}-\d{2}-\d{2}T.*Z/);
  });

  it('records a failed delivery with a clear detail when the provider type mismatches', async () => {
    await db.insert(providers).values({
      id: 'prov_wa',
      name: 'WhatsApp E2E',
      providerType: 'channel',
      apiType: 'whatsapp',
      config: { phoneNumberId: '555', accessToken: 't', appSecret: 's', verifyToken: 'vt' },
    });
    // No fetch seam: the send must not even attempt the network.
    await saveConfig((base) => ({
      ...base,
      notifiers: [{ id: 'notf_tg', type: 'telegram', channelProviderId: 'prov_wa', chatId: '@ops-team', enabled: true }],
      rules: { ...base.rules, 'high-memory': HIGH_MEMORY_FIRE },
    }));

    await engine().runNow();
    const row = await waitFor('firing alert with recorded telegram mismatch failure', async () => {
      const rows = await alertsFor('high-memory');
      return rows.length === 1 && rows[0].status === 'firing' && rows[0].notifications.length === 1 ? rows[0] : undefined;
    });
    expect(row.notifications[0].notifierId).to.equal('notf_tg');
    expect(row.notifications[0].ok).to.equal(false);
    expect(row.notifications[0].detail).to.equal('provider type mismatch: expected telegram, found whatsapp');
  });

  it('rejects invalid per-type notifier configs via PUT /api/monitoring/config (400)', async () => {
    const agent = authed();
    const getRes = await agent.get('/api/monitoring/config');
    expect(getRes.status).to.equal(200);
    const before = getRes.body as { version: number; config: MonitoringConfig };

    const badConfigs: Array<{ notifiers: MonitoringConfig['notifiers']; note: string }> = [
      { notifiers: [{ id: 'n1', type: 'telegram', channelProviderId: 'p', enabled: true }], note: 'telegram missing chatId' },
      { notifiers: [{ id: 'n2', type: 'twilio_sms', channelProviderId: 'p', to: 'not-a-phone', enabled: true }], note: 'twilio_sms bad to' },
      { notifiers: [{ id: 'n3', type: 'whatsapp', channelProviderId: 'p', to: '+0123456789', enabled: true }], note: 'whatsapp bad to' },
      { notifiers: [{ id: 'n4', type: 'email', channelProviderId: 'p', to: 'not-an-email', enabled: true }], note: 'email bad to' },
    ];
    for (const { notifiers, note } of badConfigs) {
      const res = await agent.put('/api/monitoring/config').send({ version: before.version, config: { ...before.config, notifiers } });
      expect(res.status, `${note} should be 400 (got ${res.status}: ${JSON.stringify(res.body)})`).to.equal(400);
    }

    // The row is untouched — version unchanged, config unchanged.
    const after = await agent.get('/api/monitoring/config');
    expect(after.status).to.equal(200);
    expect(after.body.version).to.equal(before.version);
  });
});

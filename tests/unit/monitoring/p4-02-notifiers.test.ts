/**
 * P4-02 — telegram / twilio_sms / whatsapp alert notifiers (spec:
 * specs/monitoring/P4-02-telegram-sms-notifiers.md).
 *
 * Hermetic: no DB, no network. Provider reads go through
 * `setProviderLoaderForTests`, sends through `setFetchForTests` /
 * `setMessagesCreateForTests`, call-log rows through
 * `setCallRecorderForTests`.
 */
import 'reflect-metadata';
import { expect } from 'chai';
import {
  monitoringConfigSchema,
  notifierConfigSchema,
  type MonitoringConfig,
  type NotifierConfig,
} from '../../../src/http/contracts/monitoring';
import type { AlertEvent } from '../../../src/services/monitoring/AlertEventPublisher';
import type { AlertNotification } from '../../../src/db/schema';
import {
  NotifyingPublisher,
} from '../../../src/services/monitoring/notifiers/AlertNotifier';
import { WebhookNotifier } from '../../../src/services/monitoring/notifiers/WebhookNotifier';
import { ChannelNotifier } from '../../../src/services/monitoring/notifiers/ChannelNotifier';
import { EmailNotifier } from '../../../src/services/monitoring/notifiers/EmailNotifier';
import { buildAlertText } from '../../../src/services/monitoring/notifiers/alertMessage';
import {
  EmailConnectionBase,
  type EmailAttachment,
} from '../../../src/channels/email/shared/EmailConnectionBase';
import type { SessionManager } from '../../../src/channels/SessionManager';

// ─── Fakes ───────────────────────────────────────────────────────────────────

type RecEntry = {
  providerId: string;
  providerType: string;
  apiType: string;
  operation: string;
  durationMs: number;
  ok: boolean;
  error?: unknown;
  statusHttp?: number | null;
};

class FakeRecorder {
  readonly entries: RecEntry[] = [];
  record(entry: RecEntry): void {
    this.entries.push(entry);
  }
}

type FetchCall = { url: string; init: RequestInit };

class FakePersister {
  readonly fires: AlertEvent[] = [];
  readonly resolves: AlertEvent[] = [];
  async fire(event: AlertEvent): Promise<void> {
    this.fires.push(event);
  }
  async resolve(event: AlertEvent): Promise<number> {
    this.resolves.push(event);
    return 1;
  }
}

class FakeConfigService {
  constructor(private readonly config: MonitoringConfig) {}
  async get(): Promise<MonitoringConfig> {
    return this.config;
  }
}

class RecordingPublisher extends NotifyingPublisher {
  readonly appended: Array<{ alertId: string; results: AlertNotification[] }> = [];
  protected async appendResults(alertId: string, results: AlertNotification[]): Promise<void> {
    this.appended.push({ alertId, results: [...results] });
  }
}

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

function makeEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: 'alrt_test',
    ruleId: 'high-memory',
    scopeKey: 'high-memory:global',
    scope: {},
    severity: 'warning',
    message: 'Process memory high',
    context: { rssBytes: 123 },
    firedAt: new Date('2026-08-19T10:00:00.000Z'),
    ...overrides,
  };
}

function fakeSecretRefUtils(): unknown {
  return {
    resolveObject: async (o: Record<string, unknown>) => o,
    resolveString: async (v: string) => v,
  };
}

function providerRow(overrides: Record<string, unknown> = {}): unknown {
  return { id: 'prov_tg', name: 'P', providerType: 'channel', apiType: 'telegram', config: {}, ...overrides };
}

const TG_CONFIG: NotifierConfig = { id: 'notf_tg', type: 'telegram', channelProviderId: 'prov_tg', chatId: '@ops', enabled: true };
const SMS_CONFIG: NotifierConfig = { id: 'notf_sms', type: 'twilio_sms', channelProviderId: 'prov_sms', to: '+15551234567', enabled: true };
const WA_CONFIG: NotifierConfig = { id: 'notf_wa', type: 'whatsapp', channelProviderId: 'prov_wa', to: '+48123456789', enabled: true };

describe('P4-02 notifierConfigSchema per-type validation', () => {
  it('accepts all five valid shapes', () => {
    const valid: NotifierConfig[] = [
      { id: 'n1', type: 'webhook', url: 'https://hooks.test/a', enabled: true },
      { id: 'n2', type: 'email', channelProviderId: 'p1', to: 'ops@test.io', enabled: true },
      { id: 'n3', type: 'telegram', channelProviderId: 'p2', chatId: '@ops', enabled: true },
      { id: 'n4', type: 'twilio_sms', channelProviderId: 'p3', to: '+15551234567', enabled: true },
      { id: 'n5', type: 'whatsapp', channelProviderId: 'p4', to: '+48123456789', enabled: true },
    ];
    for (const n of valid) {
      const parsed = notifierConfigSchema.safeParse(n);
      expect(parsed.success, `${n.type} should validate: ${JSON.stringify(parsed.success ? null : parsed.error.issues)}`).to.equal(true);
    }
  });

  it('rejects a webhook notifier without a url', () => {
    const parsed = notifierConfigSchema.safeParse({ id: 'n', type: 'webhook', enabled: true });
    expect(parsed.success).to.equal(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).to.deep.equal(['url']);
    }
  });

  it('rejects a webhook notifier with a non-http url', () => {
    const parsed = notifierConfigSchema.safeParse({ id: 'n', type: 'webhook', url: 'ftp://hooks.test/a', enabled: true });
    expect(parsed.success).to.equal(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).to.deep.equal(['url']);
    }
  });

  it('rejects an email notifier with a non-email to address', () => {
    const parsed = notifierConfigSchema.safeParse({ id: 'n', type: 'email', channelProviderId: 'p', to: '+15551234567', enabled: true });
    expect(parsed.success).to.equal(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).to.deep.equal(['to']);
    }
  });

  it('rejects a telegram notifier without a chatId', () => {
    const parsed = notifierConfigSchema.safeParse({ id: 'n', type: 'telegram', channelProviderId: 'p', enabled: true });
    expect(parsed.success).to.equal(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).to.deep.equal(['chatId']);
    }
  });

  it('rejects twilio_sms/whatsapp to values that are not E.164', () => {
    for (const bad of ['15551234567', '+0123456789', '+12345', '+1555 123 4567', 'tel:+15551234567']) {
      const parsed = notifierConfigSchema.safeParse({ id: 'n', type: 'twilio_sms', channelProviderId: 'p', to: bad, enabled: true });
      expect(parsed.success, `should reject ${bad}`).to.equal(false);
      const parsedWa = notifierConfigSchema.safeParse({ id: 'n', type: 'whatsapp', channelProviderId: 'p', to: bad, enabled: true });
      expect(parsedWa.success, `whatsapp should reject ${bad}`).to.equal(false);
    }
  });

  it('rejects twilio_sms without channelProviderId and whatsapp without to', () => {
    const parsed1 = notifierConfigSchema.safeParse({ id: 'n', type: 'twilio_sms', to: '+15551234567', enabled: true });
    expect(parsed1.success).to.equal(false);
    if (!parsed1.success) expect(parsed1.error.issues[0].path).to.deep.equal(['channelProviderId']);
    const parsed2 = notifierConfigSchema.safeParse({ id: 'n', type: 'whatsapp', channelProviderId: 'p', enabled: true });
    expect(parsed2.success).to.equal(false);
    if (!parsed2.success) expect(parsed2.error.issues[0].path).to.deep.equal(['to']);
  });

  it('keeps legacy webhook+email configs (incl. env-synthesized shapes) valid', () => {
    const config = monitoringConfigSchema.parse({
      notifiers: [
        { id: 'env_wh', type: 'webhook', url: 'https://hooks.test/x', enabled: true },
        { id: 'env_em', type: 'email', channelProviderId: 'p', to: 'ops@test.io', enabled: true },
      ],
    });
    expect(config.notifiers).to.have.length(2);
  });
});

describe('P4-02 buildAlertText', () => {
  it('formats a fired warning alert with header, message and fired footer', () => {
    const text = buildAlertText(makeEvent(), 'fired', 3900);
    const lines = text.split('\n');
    expect(lines).to.have.length(3);
    expect(lines[0]).to.equal('⚠️ Bonsai alert: high-memory — high-memory:global');
    expect(lines[1]).to.equal('Process memory high');
    expect(lines[2]).to.equal('fired: 2026-08-19T10:00:00.000Z');
  });

  it('uses the severity emoji for fired and the resolved emoji for resolved', () => {
    expect(buildAlertText(makeEvent({ severity: 'critical' }), 'fired', 3900)).to.match(/^🚨 Bonsai alert:/);
    expect(buildAlertText(makeEvent({ severity: 'info' }), 'fired', 3900)).to.match(/^ℹ️ Bonsai alert:/);
    const resolved = buildAlertText(
      makeEvent({ resolvedAt: new Date('2026-08-19T10:05:00.000Z') }),
      'resolved',
      3900,
    );
    expect(resolved).to.match(/^✅ Bonsai resolved:/);
    expect(resolved.split('\n')[2]).to.equal('fired: 2026-08-19T10:00:00.000Z / resolved: 2026-08-19T10:05:00.000Z');
  });

  it('falls back to unknown when resolvedAt is missing', () => {
    const text = buildAlertText(makeEvent(), 'resolved', 3900);
    expect(text.split('\n')[2]).to.contain('resolved: unknown');
  });

  it('truncates long messages while keeping the header intact', () => {
    const text = buildAlertText(makeEvent({ message: 'x'.repeat(5000) }), 'fired', 320);
    const lines = text.split('\n');
    expect(text.length).to.be.at.most(320);
    expect(lines[1].endsWith('…(truncated)')).to.equal(true);
    expect(lines[0]).to.equal('⚠️ Bonsai alert: high-memory — high-memory:global');
  });
});

describe('P4-02 ChannelNotifier (telegram)', () => {
  function setup() {
    const notifier = new ChannelNotifier(fakeSecretRefUtils() as never);
    const recorder = new FakeRecorder();
    const calls: FetchCall[] = [];
    let impl: (url: string, init?: RequestInit) => Promise<Response> = async () =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    notifier.setProviderLoaderForTests(async () =>
      providerRow({ id: 'prov_tg', config: { botToken: '123:FAKE' } }),
    );
    notifier.setCallRecorderForTests(recorder);
    notifier.setFetchForTests(async (url, init) => {
      calls.push({ url, init });
      return impl(url, init);
    });
    const setImpl = (fn: (url: string, init?: RequestInit) => Promise<Response>): void => {
      impl = fn;
    };
    return { notifier, recorder, calls, setImpl };
  }

  it('POSTs to the Bot API with chat_id and plain text, records an ok call row', async () => {
    const { notifier, recorder, calls } = setup();
    const result = await notifier.deliver(makeEvent(), 'fired', TG_CONFIG);
    expect(result).to.deep.equal({ ok: true });
    expect(calls).to.have.length(1);
    expect(calls[0].url).to.equal('https://api.telegram.org/bot123:FAKE/sendMessage');
    expect(calls[0].init.method).to.equal('POST');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.chat_id).to.equal('@ops');
    expect(body.text).to.contain('Bonsai alert: high-memory');
    expect(body).to.not.have.property('parse_mode');
    expect(recorder.entries).to.have.length(1);
    expect(recorder.entries[0]).to.include({
      providerId: 'prov_tg',
      providerType: 'channel',
      apiType: 'telegram',
      operation: 'channel.send_message',
      ok: true,
      statusHttp: 200,
    });
  });

  it('records a failed delivery with the API status on non-2xx', async () => {
    const { notifier, recorder, setImpl } = setup();
    setImpl(async () => new Response('Forbidden', { status: 403 }));
    const result = await notifier.deliver(makeEvent(), 'fired', TG_CONFIG);
    expect(result.ok).to.equal(false);
    expect(result.detail).to.contain('403');
    expect(result.detail).to.contain('Forbidden');
    expect(recorder.entries[0].ok).to.equal(false);
    expect(recorder.entries[0].statusHttp).to.equal(403);
  });

  it('records a network error as a failed delivery', async () => {
    const { notifier, recorder, setImpl } = setup();
    setImpl(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    const result = await notifier.deliver(makeEvent(), 'fired', TG_CONFIG);
    expect(result.ok).to.equal(false);
    expect(result.detail).to.contain('ECONNREFUSED');
    expect(recorder.entries[0].ok).to.equal(false);
  });

  it('returns config invalid without sending when chatId is missing', async () => {
    const { notifier, calls } = setup();
    const { chatId: _omit, ...config } = TG_CONFIG;
    const result = await notifier.deliver(makeEvent(), 'fired', config as NotifierConfig);
    expect(result).to.deep.equal({ ok: false, detail: 'telegram notifier missing channelProviderId/chatId (config invalid)' });
    expect(calls).to.have.length(0);
  });

  it('fails with a clear detail when the provider is missing or the type mismatches', async () => {
    const missing = new ChannelNotifier(fakeSecretRefUtils() as never);
    missing.setProviderLoaderForTests(async () => undefined);
    const r1 = await missing.deliver(makeEvent(), 'fired', TG_CONFIG);
    expect(r1.ok).to.equal(false);
    expect(r1.detail).to.equal('channel provider not found: prov_tg');

    const mismatch = new ChannelNotifier(fakeSecretRefUtils() as never);
    mismatch.setProviderLoaderForTests(async () => providerRow({ id: 'prov_tg', apiType: 'whatsapp' }));
    const r2 = await mismatch.deliver(makeEvent(), 'fired', TG_CONFIG);
    expect(r2.ok).to.equal(false);
    expect(r2.detail).to.equal('provider type mismatch: expected telegram, found whatsapp');

    const notChannel = new ChannelNotifier(fakeSecretRefUtils() as never);
    notChannel.setProviderLoaderForTests(async () => providerRow({ id: 'prov_tg', providerType: 'llm', apiType: 'openai' }));
    const r3 = await notChannel.deliver(makeEvent(), 'fired', TG_CONFIG);
    expect(r3.ok).to.equal(false);
    expect(r3.detail).to.contain('is not a channel provider');
  });

  it('abandons slow sends at the per-delivery timeout', async () => {
    const { notifier, recorder, setImpl } = setup();
    setImpl(() => new Promise<Response>(() => {}));
    notifier.setPerDeliveryTimeoutMsForTests(30);
    const started = Date.now();
    const result = await notifier.deliver(makeEvent(), 'fired', TG_CONFIG);
    expect(result.ok).to.equal(false);
    expect(result.detail).to.contain('timed out');
    expect(Date.now() - started).to.be.at.least(25);
    // Abandoned in-flight sends are not recorded (same semantics as EmailNotifier);
    // the delivery failure is visible in the notification ledger instead.
    expect(recorder.entries).to.have.length(0);
  });

  it('truncates the message to the telegram budget', async () => {
    const { notifier, calls } = setup();
    await notifier.deliver(makeEvent({ message: 'x'.repeat(5000) }), 'fired', TG_CONFIG);
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.text.length).to.be.at.most(3900);
    expect(body.text.split('\n')[1].endsWith('…(truncated)')).to.equal(true);
  });
});

describe('P4-02 ChannelNotifier (twilio_sms)', () => {
  function setup() {
    const notifier = new ChannelNotifier(fakeSecretRefUtils() as never);
    const recorder = new FakeRecorder();
    const sent: Array<{ body: string; from: string; to: string }> = [];
    let failWith: Error | null = null;
    notifier.setProviderLoaderForTests(async () =>
      providerRow({ id: 'prov_sms', apiType: 'twilio_messaging', config: { accountSid: 'AC123', authToken: 'tok', fromNumber: '+15550001111' } }),
    );
    notifier.setCallRecorderForTests(recorder);
    notifier.setMessagesCreateForTests(async (params) => {
      if (failWith) throw failWith;
      sent.push(params);
    });
    const setFail = (err: Error | null): void => {
      failWith = err;
    };
    return { notifier, recorder, sent, setFail };
  }

  it('sends from the provider fromNumber to the configured E.164, records an ok row', async () => {
    const { notifier, recorder, sent } = setup();
    const result = await notifier.deliver(makeEvent(), 'fired', SMS_CONFIG);
    expect(result).to.deep.equal({ ok: true });
    expect(sent).to.have.length(1);
    expect(sent[0].from).to.equal('+15550001111');
    expect(sent[0].to).to.equal('+15551234567');
    expect(sent[0].body).to.contain('Bonsai alert: high-memory');
    expect(recorder.entries[0]).to.include({ providerId: 'prov_sms', apiType: 'twilio_messaging', operation: 'channel.send_message', ok: true });
  });

  it('truncates the body to one SMS segment (320 chars)', async () => {
    const { notifier, sent } = setup();
    await notifier.deliver(makeEvent({ message: 'y'.repeat(5000) }), 'fired', SMS_CONFIG);
    expect(sent[0].body.length).to.be.at.most(320);
    expect(sent[0].body.split('\n')[1].endsWith('…(truncated)')).to.equal(true);
  });

  it('records a failed delivery when messages.create throws', async () => {
    const { notifier, recorder, setFail } = setup();
    setFail(new Error('20002: The "To" phone number is not valid'));
    const result = await notifier.deliver(makeEvent(), 'fired', SMS_CONFIG);
    expect(result.ok).to.equal(false);
    expect(result.detail).to.contain('20002');
    expect(recorder.entries[0].ok).to.equal(false);
  });

  it('returns config invalid without sending when to is missing', async () => {
    const { notifier, sent } = setup();
    const { to: _omit, ...config } = SMS_CONFIG;
    const result = await notifier.deliver(makeEvent(), 'fired', config as NotifierConfig);
    expect(result.detail).to.contain('config invalid');
    expect(sent).to.have.length(0);
  });

  it('fails with a clear detail when the provider type mismatches', async () => {
    const notifier = new ChannelNotifier(fakeSecretRefUtils() as never);
    notifier.setProviderLoaderForTests(async () => providerRow({ id: 'prov_sms', apiType: 'telegram' }));
    const result = await notifier.deliver(makeEvent(), 'fired', SMS_CONFIG);
    expect(result.ok).to.equal(false);
    expect(result.detail).to.equal('provider type mismatch: expected twilio_messaging, found telegram');
  });
});

describe('P4-02 ChannelNotifier (whatsapp)', () => {
  function setup() {
    const notifier = new ChannelNotifier(fakeSecretRefUtils() as never);
    const recorder = new FakeRecorder();
    const calls: FetchCall[] = [];
    let impl: (url: string, init?: RequestInit) => Promise<Response> = async () =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    notifier.setProviderLoaderForTests(async () =>
      providerRow({ id: 'prov_wa', apiType: 'whatsapp', config: { phoneNumberId: '9876543210', accessToken: 'WA-TOKEN', appSecret: 'secret', verifyToken: 'vt' } }),
    );
    notifier.setCallRecorderForTests(recorder);
    notifier.setFetchForTests(async (url, init) => {
      calls.push({ url, init });
      return impl(url, init);
    });
    const setImpl = (fn: (url: string, init?: RequestInit) => Promise<Response>): void => {
      impl = fn;
    };
    return { notifier, recorder, calls, setImpl };
  }

  it('POSTs to the Graph API with bearer auth and the Cloud API payload, records an ok row', async () => {
    const { notifier, recorder, calls } = setup();
    const result = await notifier.deliver(makeEvent(), 'fired', WA_CONFIG);
    expect(result).to.deep.equal({ ok: true });
    expect(calls[0].url).to.equal('https://graph.facebook.com/v17.0/9876543210/messages');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).to.equal('Bearer WA-TOKEN');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).to.deep.equal({
      messaging_product: 'whatsapp',
      to: '+48123456789',
      type: 'text',
      text: { body: body.text.body },
    });
    expect(body.text.body).to.contain('Bonsai alert: high-memory');
    expect(recorder.entries[0]).to.include({ providerId: 'prov_wa', apiType: 'whatsapp', operation: 'channel.send_message', ok: true, statusHttp: 200 });
  });

  it('records a failed delivery with the Graph API status on non-2xx', async () => {
    const { notifier, recorder, setImpl } = setup();
    setImpl(async () => new Response('"error":{"message":"Unsupported message type"}', { status: 400 }));
    const result = await notifier.deliver(makeEvent(), 'fired', WA_CONFIG);
    expect(result.ok).to.equal(false);
    expect(result.detail).to.contain('400');
    expect(recorder.entries[0].ok).to.equal(false);
    expect(recorder.entries[0].statusHttp).to.equal(400);
  });

  it('truncates the body to the whatsapp budget', async () => {
    const { notifier, calls } = setup();
    await notifier.deliver(makeEvent({ message: 'z'.repeat(5000) }), 'fired', WA_CONFIG);
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.text.body.length).to.be.at.most(4000);
    expect(body.text.body.split('\n')[1].endsWith('…(truncated)')).to.equal(true);
  });

  it('fails with a clear detail when the provider type mismatches', async () => {
    const notifier = new ChannelNotifier(fakeSecretRefUtils() as never);
    notifier.setProviderLoaderForTests(async () => providerRow({ id: 'prov_wa', apiType: 'twilio_messaging' }));
    const result = await notifier.deliver(makeEvent(), 'fired', WA_CONFIG);
    expect(result.ok).to.equal(false);
    expect(result.detail).to.equal('provider type mismatch: expected whatsapp, found twilio_messaging');
  });
});

describe('P4-02 NotifyingPublisher five-way dispatch', () => {
  it('routes each notifier type to its implementation', async function () {
    // Give the webhook notifier a local 200 receiver-free global fetch stub:
    // the publisher test only needs the webhook to succeed once.
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => new Response(null, { status: 200 });
    try {
      const persister = new FakePersister();
      // The consolidated ChannelNotifier serves all three channel types —
      // one instance, one id-keyed provider loader, one fetch seam (the
      // telegram vs whatsapp sends are distinguished by URL).
      const channel = new ChannelNotifier(fakeSecretRefUtils() as never);
      const fetchCalls: FetchCall[] = [];
      channel.setProviderLoaderForTests(async (providerId) => {
        if (providerId === 'prov_tg') return providerRow({ id: 'prov_tg', config: { botToken: '1:2' } });
        if (providerId === 'prov_sms') return providerRow({ id: 'prov_sms', apiType: 'twilio_messaging', config: { accountSid: 'AC1', authToken: 't', fromNumber: '+15550001111' } });
        return providerRow({ id: 'prov_wa', apiType: 'whatsapp', config: { phoneNumberId: '1', accessToken: 't', appSecret: 's', verifyToken: 'vt' } });
      });
      channel.setFetchForTests(async (url) => {
        fetchCalls.push({ url, init: {} });
        return new Response('{}', { status: 200 });
      });
      const smsSent: Array<{ to: string }> = [];
      channel.setMessagesCreateForTests(async (params) => {
        smsSent.push(params);
      });
      const email = new EmailNotifier(fakeSecretRefUtils() as never, {} as SessionManager);
      const emailConn = new FakeEmailConnection();
      email.setProviderLoaderForTests(async () => providerRow({ id: 'prov_em', apiType: 'sendgrid', config: { apiKey: 'k', fromAddress: 'a@b.test', threadingStrategy: 'messageId' } }));
      email.setConnectionBuilderForTests(() => emailConn);

      const config = monitoringConfigSchema.parse({
        notifiers: [
          { id: 'n_wh', type: 'webhook', url: 'http://hooks.test/a', enabled: true },
          { id: 'n_em', type: 'email', channelProviderId: 'prov_em', to: 'ops@test.io', enabled: true },
          { id: 'n_tg', type: 'telegram', channelProviderId: 'prov_tg', chatId: '@ops', enabled: true },
          { id: 'n_sms', type: 'twilio_sms', channelProviderId: 'prov_sms', to: '+15551234567', enabled: true },
          { id: 'n_wa', type: 'whatsapp', channelProviderId: 'prov_wa', to: '+48123456789', enabled: true },
        ],
      });

      const publisher = new RecordingPublisher(
        persister as never,
        new FakeConfigService(config) as never,
        new WebhookNotifier(),
        email,
        channel,
      );
      await publisher.fire(makeEvent());

      const telegramCalls = fetchCalls.filter((c) => c.url.includes('api.telegram.org'));
      const whatsappCalls = fetchCalls.filter((c) => c.url.includes('graph.facebook.com'));
      expect(persister.fires).to.have.length(1);
      expect(telegramCalls).to.have.length(1);
      expect(smsSent).to.have.length(1);
      expect(whatsappCalls).to.have.length(1);
      expect(emailConn.sent).to.have.length(1);

      const appended = publisher.appended[0];
      expect(appended.alertId).to.equal('alrt_test');
      const byNotifier = new Map(appended.results.map((r) => [r.notifierId, r]));
      expect([...byNotifier.keys()].sort()).to.deep.equal(['n_em', 'n_sms', 'n_tg', 'n_wa', 'n_wh']);
      for (const result of appended.results) {
        expect(result.ok, `${result.notifierId} should deliver ok`).to.equal(true);
      }
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });
});

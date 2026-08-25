/**
 * P2-02 — notifiers: webhook + email delivery, publisher fan-out, severity
 * floor, retries, and caps (spec: .issues/proposal/monitoring/P2-02-notifiers.md).
 *
 * No network: `fetch` is stubbed globally, and email delivery goes through
 * the `EmailNotifier` test seams (provider loader + connection builder).
 */
import 'reflect-metadata';
import { expect } from 'chai';
import {
  monitoringConfigSchema,
  type MonitoringConfig,
  type NotifierConfig,
} from '../../../src/http/contracts/monitoring';
import type { AlertEvent } from '../../../src/services/monitoring/AlertEventPublisher';
import type { AlertNotification } from '../../../src/db/schema';
import {
  NotifyingPublisher,
  type AlertNotifier,
} from '../../../src/services/monitoring/notifiers/AlertNotifier';
import { WebhookNotifier } from '../../../src/services/monitoring/notifiers/WebhookNotifier';
import { ChannelNotifier } from '../../../src/services/monitoring/notifiers/ChannelNotifier';
import { EmailNotifier } from '../../../src/services/monitoring/notifiers/EmailNotifier';
import {
  EmailConnectionBase,
  type EmailAttachment,
} from '../../../src/channels/email/shared/EmailConnectionBase';
import type { SessionManager } from '../../../src/channels/SessionManager';

// ─── Fakes ───────────────────────────────────────────────────────────────────

class FakeEmailConnection extends EmailConnectionBase {
  readonly connectionType = 'sendgrid' as const;
  readonly sent: Array<{ to: string; subject: string; body: string }> = [];
  hang = false;

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
    if (this.hang) {
      await new Promise(() => {});
      return;
    }
    this.sent.push({ to, subject, body });
  }
}

class FakePersister {
  readonly fires: AlertEvent[] = [];
  readonly resolves: AlertEvent[] = [];
  /** Rows transitioned to resolved (0 = the row was deleted out from under the engine). */
  resolvedRows = 1;
  async fire(event: AlertEvent): Promise<void> {
    this.fires.push(event);
  }
  async resolve(event: AlertEvent): Promise<number> {
    this.resolves.push(event);
    return this.resolvedRows;
  }
}

class FakeConfigService {
  config: MonitoringConfig;
  fail = false;
  constructor(config: MonitoringConfig) {
    this.config = config;
  }
  async get(): Promise<MonitoringConfig> {
    if (this.fail) throw new Error('config service down');
    return this.config;
  }
}

/** Recording subclass — `appendResults` is the only DB-touching private path. */
class RecordingPublisher extends NotifyingPublisher {
  readonly appended: Array<{ alertId: string; results: AlertNotification[] }> = [];
  protected async appendResults(alertId: string, results: AlertNotification[]): Promise<void> {
    this.appended.push({ alertId, results: [...results] });
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

function baseConfig(notifiers: NotifierConfig[]): MonitoringConfig {
  return monitoringConfigSchema.parse({ notifiers });
}

function fakeSecretRefUtils(): unknown {
  return {
    resolveObject: async (o: Record<string, unknown>) => o,
    resolveString: async (v: string) => v,
  };
}

function emailNotifierWith(providerRow: unknown): { notifier: EmailNotifier; conn: FakeEmailConnection } {
  const notifier = new EmailNotifier(fakeSecretRefUtils() as never, {} as SessionManager);
  const conn = new FakeEmailConnection();
  notifier.setProviderLoaderForTests(() => providerRow);
  notifier.setConnectionBuilderForTests(() => conn);
  return { notifier, conn };
}

// ─── fetch stub ──────────────────────────────────────────────────────────────

type FetchCall = { url: string; init: RequestInit };
let fetchCalls: FetchCall[];
let fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
const originalFetch = globalThis.fetch;

function abortingHangingFetch(url: string, init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_, reject) => {
    const signal = init?.signal as AbortSignal | undefined;
    const fail = () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    };
    if (!signal) return;
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener('abort', fail);
  });
}

beforeEach(() => {
  fetchCalls = [];
  fetchImpl = async () => new Response(null, { status: 200 });
  (globalThis as any).fetch = (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init: init ?? {} });
    return fetchImpl(url, init);
  };
});

after(() => {
  (globalThis as any).fetch = originalFetch;
});

// ─── WebhookNotifier ─────────────────────────────────────────────────────────

describe('P2-02 WebhookNotifier', () => {
  const url = 'http://hooks.test/alerts';
  const config: NotifierConfig = { id: 'notf_wh', type: 'webhook', url, enabled: true };

  function notifier(): WebhookNotifier {
    return new WebhookNotifier();
  }

  it('POSTs the documented payload with fixed headers on success', async () => {
    const result = await notifier().deliver(makeEvent(), 'fired', config);
    expect(result).to.deep.equal({ ok: true });
    expect(fetchCalls).to.have.length(1);
    const call = fetchCalls[0];
    expect(call.url).to.equal(url);
    expect(call.init.method).to.equal('POST');
    const headers = call.init.headers as Record<string, string>;
    expect(headers['Content-Type']).to.equal('application/json');
    expect(headers['User-Agent']).to.equal('bonsai-backend-monitoring/1.0');
    const body = JSON.parse(call.init.body as string);
    expect(body).to.deep.equal({
      event: 'alert_fired',
      ruleId: 'high-memory',
      severity: 'warning',
      scopeKey: 'high-memory:global',
      scope: {},
      message: 'Process memory high',
      context: { rssBytes: 123 },
      firedAt: '2026-08-19T10:00:00.000Z',
    });
    expect(body).to.not.have.property('resolvedAt');
  });

  it('sends alert_resolved with resolvedAt on the resolved phase', async () => {
    const event = makeEvent({ resolvedAt: new Date('2026-08-19T10:05:00.000Z') });
    const result = await notifier().deliver(event, 'resolved', config);
    expect(result).to.deep.equal({ ok: true });
    const body = JSON.parse(fetchCalls[0].init.body as string);
    expect(body.event).to.equal('alert_resolved');
    expect(body.resolvedAt).to.equal('2026-08-19T10:05:00.000Z');
  });

  it('records non-2xx responses without retrying', async () => {
    fetchImpl = async () => new Response(null, { status: 500 });
    const result = await notifier().deliver(makeEvent(), 'fired', config);
    expect(result).to.deep.equal({ ok: false, detail: 'HTTP 500' });
    expect(fetchCalls).to.have.length(1);
  });

  it('retries exactly once on transport failure, then records the error', async () => {
    fetchImpl = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    const result = await notifier().deliver(makeEvent(), 'fired', config);
    expect(result.ok).to.equal(false);
    expect(result.detail).to.contain('transport error');
    expect(result.detail).to.contain('ECONNREFUSED');
    expect(fetchCalls).to.have.length(2);
  });

  it('succeeds when the retry succeeds', async () => {
    let attempts = 0;
    fetchImpl = async () => {
      attempts++;
      if (attempts === 1) throw new Error('connect ECONNREFUSED');
      return new Response(null, { status: 202 });
    };
    const result = await notifier().deliver(makeEvent(), 'fired', config);
    expect(result).to.deep.equal({ ok: true });
    expect(attempts).to.equal(2);
  });

  it('aborts slow deliveries at the per-attempt timeout (both attempts)', async () => {
    fetchImpl = abortingHangingFetch;
    const n = notifier();
    n.setPerAttemptTimeoutMsForTests(50);
    const started = Date.now();
    const result = await n.deliver(makeEvent(), 'fired', config);
    expect(result.ok).to.equal(false);
    expect(result.detail).to.contain('transport error');
    expect(fetchCalls).to.have.length(2);
    expect(Date.now() - started).to.be.at.least(80);
  });

  it('fails cleanly when the url is missing', async () => {
    const { url: _url, ...noUrl } = config;
    const result = await notifier().deliver(makeEvent(), 'fired', noUrl);
    expect(result.ok).to.equal(false);
    expect(result.detail).to.contain('missing url');
    expect(fetchCalls).to.have.length(0);
  });
});

// ─── EmailNotifier ───────────────────────────────────────────────────────────

describe('P2-02 EmailNotifier', () => {
  const config: NotifierConfig = {
    id: 'notf_email',
    type: 'email',
    channelProviderId: 'prov_sendgrid',
    to: 'ops@fake.test',
    enabled: true,
  };

  const sendGridProvider = {
    id: 'prov_sendgrid',
    providerType: 'channel',
    apiType: 'sendgrid',
    name: 'SendGrid Test',
    config: { apiKey: 'SG.fake', fromAddress: 'alerts@fake.test', threadingStrategy: 'messageId' },
  };

  it('delivers via the provider connection with the documented subject/body', async () => {
    const { notifier, conn } = emailNotifierWith(sendGridProvider);
    const result = await notifier.deliver(makeEvent(), 'fired', config);
    expect(result).to.deep.equal({ ok: true });
    expect(conn.sent).to.have.length(1);
    const sent = conn.sent[0];
    expect(sent.to).to.equal('ops@fake.test');
    expect(sent.subject).to.equal('[Bonsai][WARNING] high-memory — high-memory:global');
    expect(sent.body).to.contain('Bonsai alert fired');
    expect(sent.body).to.contain('Process memory high');
    expect(sent.body).to.contain('Rule: high-memory');
    expect(sent.body).to.contain('Fired at: 2026-08-19T10:00:00.000Z');
    expect(sent.body).to.contain('"rssBytes": 123');
  });

  it('includes the resolved timestamp on resolved deliveries', async () => {
    const { notifier, conn } = emailNotifierWith(sendGridProvider);
    await notifier.deliver(makeEvent({ resolvedAt: new Date('2026-08-19T10:05:00.000Z') }), 'resolved', config);
    expect(conn.sent[0].subject).to.equal('[Bonsai][WARNING] high-memory — high-memory:global');
    expect(conn.sent[0].body).to.contain('Bonsai alert resolved');
    expect(conn.sent[0].body).to.contain('Resolved at: 2026-08-19T10:05:00.000Z');
  });

  it('fails with a recorded detail when the provider row is missing', async () => {
    const { notifier } = emailNotifierWith(undefined);
    const result = await notifier.deliver(makeEvent(), 'fired', config);
    expect(result.ok).to.equal(false);
    expect(result.detail).to.contain('channel provider not found: prov_sendgrid');
  });

  it('rejects non-channel provider types', async () => {
    const { notifier } = emailNotifierWith({ ...sendGridProvider, providerType: 'llm' });
    const result = await notifier.deliver(makeEvent(), 'fired', config);
    expect(result.ok).to.equal(false);
    expect(result.detail).to.contain('not a channel provider');
  });

  it('fails on unsupported channel apiTypes (no connection attempted)', async () => {
    const notifier = new EmailNotifier(fakeSecretRefUtils() as never, {} as SessionManager);
    notifier.setProviderLoaderForTests(() => ({ ...sendGridProvider, apiType: 'telegram' }));
    const result = await notifier.deliver(makeEvent(), 'fired', config);
    expect(result.ok).to.equal(false);
    expect(result.detail).to.contain('unsupported channel provider apiType');
  });

  it('fails when the channel config does not match the provider schema', async () => {
    const { notifier } = emailNotifierWith({ ...sendGridProvider, config: { fromAddress: 'alerts@fake.test' } });
    const result = await notifier.deliver(makeEvent(), 'fired', config);
    expect(result.ok).to.equal(false);
    expect(result.detail).to.contain('apiKey');
  });

  it('times out slow deliveries with the per-delivery cap', async () => {
    const { notifier, conn } = emailNotifierWith(sendGridProvider);
    conn.hang = true;
    notifier.setPerDeliveryTimeoutMsForTests(50);
    const result = await notifier.deliver(makeEvent(), 'fired', config);
    expect(result.ok).to.equal(false);
    expect(result.detail).to.contain('timed out after 50 ms');
  });

  it('fails cleanly when to/channelProviderId is missing', async () => {
    const { to: _to, ...noTo } = config;
    const result = await new EmailNotifier(fakeSecretRefUtils() as never, {} as SessionManager)
      .deliver(makeEvent(), 'fired', noTo);
    expect(result.ok).to.equal(false);
    expect(result.detail).to.contain('missing to/channelProviderId');
  });

  it('truncates large contexts in the body', async () => {
    const { notifier, conn } = emailNotifierWith(sendGridProvider);
    const event = makeEvent({ context: { big: 'x'.repeat(5000) } });
    await notifier.deliver(event, 'fired', config);
    const body = conn.sent[0].body;
    expect(body).to.contain('…(truncated)');
    expect(body.length).to.be.at.most(2600);
  });
});

// ─── NotifyingPublisher ──────────────────────────────────────────────────────

describe('P2-02 NotifyingPublisher', () => {
  function setup(
    notifiers: NotifierConfig[],
    overrides: { webhook?: WebhookNotifier; email?: AlertNotifier } = {},
  ) {
    const persister = new FakePersister();
    const configService = new FakeConfigService(baseConfig(notifiers));
    const webhook = overrides.webhook ?? new WebhookNotifier();
    const email = (overrides.email ?? new EmailNotifier(fakeSecretRefUtils() as never, {} as SessionManager)) as AlertNotifier;
    // P4-02 consolidation: the publisher's 3rd channel slot is the shared
    // ChannelNotifier (telegram/twilio_sms/whatsapp) — p2-02 only dispatches
    // webhook/email, so a plain instance with all-default seams is fine.
    const publisher = new RecordingPublisher(persister as never, configService as never, webhook, email as never, new ChannelNotifier(fakeSecretRefUtils() as never) as never);
    return { persister, configService, publisher, webhook, email };
  }

  const webhookConfig: NotifierConfig = { id: 'notf_wh', type: 'webhook', url: 'http://hooks.test/alerts', enabled: true };
  const emailConfig: NotifierConfig = {
    id: 'notf_email',
    type: 'email',
    channelProviderId: 'prov_sendgrid',
    to: 'ops@fake.test',
    enabled: true,
  };
  const sendGridProvider = {
    id: 'prov_sendgrid',
    providerType: 'channel',
    apiType: 'sendgrid',
    name: 'SendGrid Test',
    config: { apiKey: 'SG.fake', fromAddress: 'alerts@fake.test', threadingStrategy: 'messageId' },
  };

  it('persists first, then notifies; records results on the alert row', async () => {
    const { persister, publisher } = setup([webhookConfig]);
    const event = makeEvent();
    await publisher.fire(event);
    await publisher.resolve({ ...event, resolvedAt: new Date('2026-08-19T10:05:00.000Z') });

    expect(persister.fires).to.have.length(1);
    expect(persister.resolves).to.have.length(1);
    expect(publisher.appended).to.have.length(2);
    const fired = publisher.appended[0];
    expect(fired.alertId).to.equal('alrt_test');
    expect(fired.results).to.have.length(1);
    expect(fired.results[0].notifierId).to.equal('notf_wh');
    expect(fired.results[0].phase).to.equal('fired');
    expect(fired.results[0].ok).to.equal(true);
    expect(fired.results[0].detail).to.equal(undefined);
    expect(new Date(fired.results[0].at!).toISOString()).to.not.equal('Invalid Date');
    expect(publisher.appended[1].results[0].phase).to.equal('resolved');
  });

  it('does not notify on resolve when the persister transitioned no row (alert deleted)', async () => {
    const { persister, publisher } = setup([webhookConfig]);
    persister.resolvedRows = 0;
    await publisher.fire(makeEvent());
    await publisher.resolve({ ...makeEvent(), resolvedAt: new Date('2026-08-19T10:05:00.000Z') });

    expect(persister.resolves).to.have.length(1);
    // Only the fired phase produced a delivery + results append.
    expect(publisher.appended).to.have.length(1);
    expect(publisher.appended[0].results[0].phase).to.equal('fired');
  });

  it('skips disabled notifiers entirely (no delivery, no results)', async () => {
    const { publisher } = setup([{ ...webhookConfig, enabled: false }]);
    await publisher.fire(makeEvent());
    expect(fetchCalls).to.have.length(0);
    expect(publisher.appended).to.have.length(0);
  });

  it('applies the minSeverity floor (default = all)', async () => {
    // default: info events are delivered
    let { publisher } = setup([webhookConfig]);
    await publisher.fire(makeEvent({ severity: 'info' }));
    expect(fetchCalls).to.have.length(1);
    fetchCalls = [];

    // critical floor: warning and info are skipped
    ({ publisher } = setup([{ ...webhookConfig, minSeverity: 'critical' }]));
    await publisher.fire(makeEvent({ severity: 'warning' }));
    await publisher.fire(makeEvent({ severity: 'info', id: 'alrt_info' }));
    expect(fetchCalls).to.have.length(0);
    expect(publisher.appended).to.have.length(0);

    // critical floor: critical is delivered
    ({ publisher } = setup([{ ...webhookConfig, minSeverity: 'critical' }]));
    await publisher.fire(makeEvent({ severity: 'critical' }));
    expect(fetchCalls).to.have.length(1);
    expect(publisher.appended).to.have.length(1);

    // warning floor: critical is delivered, info is not
    ({ publisher } = setup([{ ...webhookConfig, minSeverity: 'warning' }]));
    fetchCalls = [];
    await publisher.fire(makeEvent({ severity: 'critical' }));
    await publisher.fire(makeEvent({ severity: 'info', id: 'alrt_info' }));
    expect(fetchCalls).to.have.length(1);
    expect(publisher.appended).to.have.length(1);
  });

  it('fans out in parallel to multiple notifiers of mixed types', async () => {
    const { notifier: emailNotifier, conn } = emailNotifierWith(sendGridProvider);
    const { publisher } = setup([webhookConfig, emailConfig], { email: emailNotifier as AlertNotifier });
    await publisher.fire(makeEvent());
    expect(fetchCalls).to.have.length(1);
    expect(conn.sent).to.have.length(1);
    expect(publisher.appended).to.have.length(1);
    const results = publisher.appended[0].results;
    expect(results).to.have.length(2);
    const byId = new Map(results.map((r) => [r.notifierId, r]));
    expect(byId.get('notf_wh')?.ok).to.equal(true);
    expect(byId.get('notf_email')?.ok).to.equal(true);
  });

  it('records one notifier failure without affecting the others', async () => {
    fetchImpl = async () => new Response(null, { status: 503 });
    const { notifier: emailNotifier, conn } = emailNotifierWith(sendGridProvider);
    const { publisher } = setup([webhookConfig, emailConfig], { email: emailNotifier as AlertNotifier });
    await publisher.fire(makeEvent());
    const results = publisher.appended[0].results;
    const byId = new Map(results.map((r) => [r.notifierId, r]));
    expect(byId.get('notf_wh')?.ok).to.equal(false);
    expect(byId.get('notf_wh')?.detail).to.equal('HTTP 503');
    expect(byId.get('notf_email')?.ok).to.equal(true);
    expect(conn.sent).to.have.length(1);
  });

  it('never throws when the config service fails (persist still happened)', async () => {
    const { persister, configService, publisher } = setup([webhookConfig]);
    configService.fail = true;
    await publisher.fire(makeEvent());
    expect(persister.fires).to.have.length(1);
    expect(publisher.appended).to.have.length(0);
    expect(fetchCalls).to.have.length(0);
  });

  it('records unexpected notifier errors as failed deliveries', async () => {
    const throwingEmail: AlertNotifier = {
      type: 'email',
      deliver: async () => {
        throw new Error('boom');
      },
    };
    const { publisher } = setup([emailConfig], { email: throwingEmail });
    await publisher.fire(makeEvent());
    const results = publisher.appended[0].results;
    expect(results[0].ok).to.equal(false);
    expect(results[0].detail).to.contain('unexpected error: boom');
  });

  it('records a publisher cap overrun as an incomplete delivery', async () => {
    fetchImpl = abortingHangingFetch;
    const { publisher, webhook } = setup([webhookConfig]);
    webhook.setPerAttemptTimeoutMsForTests(400);
    publisher.setPublisherCapMsForTests(80);
    await publisher.fire(makeEvent());
    const results = publisher.appended[0].results;
    expect(results).to.have.length(1);
    expect(results[0].ok).to.equal(false);
    expect(results[0].detail).to.equal('incomplete: 15s publisher cap');
  });
});

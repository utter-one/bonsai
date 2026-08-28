import 'reflect-metadata';
import http from 'node:http';
import net from 'node:net';
import { AddressInfo } from 'node:net';
import { container } from 'tsyringe';
import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { testChannelConnection, setChannelApiBaseForTests, CHANNEL_API_TYPES } from '../../../src/services/providers/connectionTest/channelStrategy';
import { CallLogger, type ProviderCallEntry, type ProviderCallLogRow } from '../../../src/services/monitoring/CallLogger';
import { MetricsRegistry } from '../../../src/services/monitoring/MetricsRegistry';
import { ProviderCallRecorder, resetMonitoringAccessorsForTests } from '../../../src/services/monitoring/ProviderCallRecorder';
import { ProviderConnectionTester } from '../../../src/services/providers/connectionTest/ProviderConnectionTester';
import { NotFoundError } from '../../../src/errors';
import type { Provider } from '../../../src/types/models';
import type { RequestContext } from '../../../src/services/RequestContext';

// --- quiet monitoring doubles (p1-03 pattern, for the full-tester tests) ---

class TestBreakerRegistry {
  successes: string[] = [];
  failures: Array<{ providerId: string; errorCode: string | null | undefined }> = [];
  recordSuccess(providerId: string): void {
    this.successes.push(providerId);
  }
  recordFailure(providerId: string, errorCode: string | null | undefined): void {
    this.failures.push({ providerId, errorCode });
  }
  reset(): void {
    this.successes.length = 0;
    this.failures.length = 0;
  }
}

const sharedBreakers = new TestBreakerRegistry();

class QuietCallLogger extends CallLogger {
  rows: ProviderCallLogRow[] = [];
  constructor(breakers: TestBreakerRegistry) {
    super(breakers as never);
  }
  get pendingEntries(): ProviderCallEntry[] {
    return this.buffer;
  }
  clearPending(): void {
    this.buffer.length = 0;
  }
  protected async persistRows(rows: ProviderCallLogRow[]): Promise<void> {
    this.rows.push(...rows);
  }
  protected onFlushError(): void {
    /* captured nowhere */
  }
}

class QuietMetrics extends MetricsRegistry {
  protected override async persistRows(_rows: unknown[]): Promise<void> {
    /* discard */
  }
  protected override onFlushError(): void {
    /* discard */
  }
}

const sharedCallLogger = new QuietCallLogger(sharedBreakers);
const sharedMetrics = new QuietMetrics();

// --- fake HTTP server (telegram / twilio / whatsapp / sendgrid / ses) ---

interface FakeHttp {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  setStatus: (status: number, body?: string, contentType?: string) => void;
  baseUrl: () => string;
  seen: Array<{ path: string; auth?: string; method?: string }>;
}

function createFakeHttpServer(): FakeHttp {
  let status = 200;
  let body = '{}';
  let contentType = 'application/json';
  const seen: FakeHttp['seen'] = [];
  const server = http.createServer((req, res) => {
    seen.push({ path: req.url ?? '', auth: req.headers.authorization, method: req.method });
    res.writeHead(status, { 'Content-Type': contentType });
    res.end(body);
  });
  return {
    start: () => new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve())),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
    setStatus: (s: number, b?: string, ct?: string) => {
      status = s;
      body = b ?? '{}';
      contentType = ct ?? 'application/json';
    },
    baseUrl: () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    seen,
  };
}

// --- fake SMTP server (raw socket; nodemailer verify() speaks to it) ---

interface FakeSmtp {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  setAuthOk: (ok: boolean) => void;
  port: () => number;
  getTranscript: () => string;
}

function createFakeSmtpServer(): FakeSmtp {
  let authOk = true;
  let lastTranscript = '';
  const server = net.createServer((socket) => {
    lastTranscript = '';
    socket.write('220 fake ESMTP\r\n');
    socket.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      lastTranscript += text;
      if (/^EHLO /m.test(text) || /^HELO /m.test(text)) {
        socket.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
      } else if (/^AUTH PLAIN /m.test(text)) {
        const token = text.match(/^AUTH PLAIN (.+)$/m)?.[1]?.trim();
        let user = '';
        let pass = '';
        try {
          const parts = Buffer.from(token ?? '', 'base64').toString('utf8').split('\u0000');
          user = parts[1] ?? '';
          pass = parts[2] ?? '';
        } catch {
          /* malformed token */
        }
        if (authOk && user === 'smtp-user' && pass === 'smtp-pass') {
          socket.write('235 Authentication succeeded\r\n');
        } else {
          socket.write('535 5.7.8 Authentication credentials invalid\r\n');
        }
      } else if (/^QUIT/m.test(text)) {
        socket.write('221 Bye\r\n');
        socket.end();
      }
    });
  });
  return {
    start: () => new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve())),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
    setAuthOk: (ok: boolean) => {
      authOk = ok;
    },
    port: () => (server.address() as AddressInfo).port,
    getTranscript: () => lastTranscript,
  };
}

// --- fake IMAP server (raw socket; the raw-socket IMAP client speaks to it) ---

interface FakeImap {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  setLoginOk: (ok: boolean) => void;
  port: () => number;
  getTranscript: () => string;
}

function createFakeImapServer(): FakeImap {
  let loginOk = true;
  let lastTranscript = '';
  const server = net.createServer((socket) => {
    // The client destroys its end mid-LOGOUT (before reading the final response),
    // which resets this end; without a listener that surfaces as an uncaught
    // ECONNRESET after the test has already resolved.
    socket.on('error', () => { /* no-op */ });
    lastTranscript = '';
    socket.write('* OK [CAPABILITY IMAP4rev1] fake\r\n');
    socket.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      lastTranscript += text;
      if (/^A001 LOGIN /m.test(text)) {
        if (loginOk) {
          socket.write('A001 OK LOGIN completed\r\n');
        } else {
          socket.write('A001 NO LOGIN failed\r\n');
        }
      } else if (/^A002 LOGOUT/m.test(text)) {
        socket.write('* BYE\r\nA002 OK LOGOUT completed\r\n');
        socket.end();
      }
    });
  });
  return {
    start: () => new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve())),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
    setLoginOk: (ok: boolean) => {
      loginOk = ok;
    },
    port: () => (server.address() as AddressInfo).port,
    getTranscript: () => lastTranscript,
  };
}

// --- full-tester doubles (for the protocol / SUPPORTED_TYPES tests) ---

const context: RequestContext = {
  operatorId: 'op_unit',
  roles: ['super_admin'],
  ip: '127.0.0.1',
  userAgent: 'unit-test',
  requestId: 'req_unit',
  timestamp: new Date(),
};

function savedChannelProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'prov_channel_1',
    name: 'Telegram',
    description: null,
    providerType: 'channel',
    apiType: 'telegram',
    config: { botToken: '123:ABC' } as Provider['config'],
    fallbacks: [],
    createdBy: null,
    tags: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

class TestTester extends ProviderConnectionTester {
  providers = new Map<string, Provider>();
  protected override async loadProvider(id: string): Promise<Provider> {
    const row = this.providers.get(id);
    if (!row) throw new NotFoundError(`Provider with id ${id} not found`);
    return row;
  }
}

describe('Channel connection tests (TPC-08)', function () {
  this.timeout(20_000);

  let fakeHttp: FakeHttp;
  let fakeSmtp: FakeSmtp;
  let fakeImap: FakeImap;
  const cleanups: Array<() => void> = [];

  before(async () => {
    fakeHttp = createFakeHttpServer();
    fakeSmtp = createFakeSmtpServer();
    fakeImap = createFakeImapServer();
    await fakeHttp.start();
    await fakeSmtp.start();
    await fakeImap.start();
    // Container seams (must precede the first accessor resolution in this file).
    container.registerInstance(CallLogger, sharedCallLogger);
    container.registerInstance(MetricsRegistry, sharedMetrics);
    container.registerInstance(ProviderCallRecorder, new ProviderCallRecorder(sharedCallLogger, sharedMetrics));
    resetMonitoringAccessorsForTests();
  });

  after(async () => {
    cleanups.forEach((fn) => fn());
    await fakeHttp.stop();
    await fakeSmtp.stop();
    await fakeImap.stop();
  });

  beforeEach(() => {
    fakeHttp.setStatus(200);
    fakeHttp.seen.length = 0;
    fakeSmtp.setAuthOk(true);
    fakeImap.setLoginOk(true);
    sharedCallLogger.rows.length = 0;
    sharedCallLogger.clearPending();
    sharedBreakers.reset();
    resetMonitoringAccessorsForTests();
  });

  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  function base(apiType: string): string {
    const fn = setChannelApiBaseForTests(apiType, fakeHttp.baseUrl());
    cleanups.push(fn);
    return fakeHttp.baseUrl();
  }

  // --- telegram ---

  describe('telegram (Bot API getMe)', () => {
    it('200 → ok:true, phase auth', async () => {
      base('telegram');
      fakeHttp.setStatus(200, JSON.stringify({ ok: true, result: { id: 1, is_bot: true, first_name: 'TestBot', username: 'testbot' } }));
      const outcome = await testChannelConnection('telegram', { botToken: '123:ABC' });
      expect(outcome.ok).to.equal(true);
      expect(outcome.phase).to.equal('auth');
      expect(outcome.errorCode).to.equal(null);
      const req = fakeHttp.seen.find((r) => r.path === '/bot123:ABC/getMe');
      expect(req).to.not.equal(undefined);
    });

    it('401 → ok:false, errorCode auth (bad token)', async () => {
      base('telegram');
      fakeHttp.setStatus(401, JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' }));
      const outcome = await testChannelConnection('telegram', { botToken: '123:BAD' });
      expect(outcome.ok).to.equal(false);
      expect(outcome.errorCode).to.equal('auth');
      expect(outcome.phase).to.equal('auth');
    });

    it('missing botToken → client_error (no network call)', async () => {
      base('telegram');
      const before = fakeHttp.seen.length;
      const outcome = await testChannelConnection('telegram', {});
      expect(outcome.ok).to.equal(false);
      expect(outcome.errorCode).to.equal('client_error');
      expect(fakeHttp.seen.length).to.equal(before);
    });
  });

  // --- slack (Web API auth.test) ---

  describe('slack (Web API auth.test)', () => {
    it('200 + ok:true → ok:true, phase auth (Bearer bot token, GET /auth.test)', async () => {
      base('slack');
      fakeHttp.setStatus(200, JSON.stringify({ ok: true, team: 'T123', user: 'U123', user_id: 'U123', team_id: 'T123' }));
      const outcome = await testChannelConnection('slack', { botToken: 'xoxb-test-token' });
      expect(outcome.ok).to.equal(true);
      expect(outcome.phase).to.equal('auth');
      expect(outcome.errorCode).to.equal(null);
      const req = fakeHttp.seen.find((r) => r.path === '/auth.test');
      expect(req).to.not.equal(undefined);
      expect(req!.auth).to.equal('Bearer xoxb-test-token');
    });

    it('401 + invalid_auth → ok:false, errorCode auth', async () => {
      base('slack');
      fakeHttp.setStatus(401, JSON.stringify({ ok: false, error: 'invalid_auth' }));
      const outcome = await testChannelConnection('slack', { botToken: 'xoxb-bad' });
      expect(outcome.ok).to.equal(false);
      expect(outcome.errorCode).to.equal('auth');
      expect(outcome.phase).to.equal('auth');
    });

    it('200 + ok:false invalid_auth → ok:false, errorCode auth (body signal, not just HTTP status)', async () => {
      base('slack');
      fakeHttp.setStatus(200, JSON.stringify({ ok: false, error: 'invalid_auth' }));
      const outcome = await testChannelConnection('slack', { botToken: 'xoxb-bad' });
      expect(outcome.ok).to.equal(false);
      expect(outcome.errorCode).to.equal('auth');
    });

    it('missing botToken → client_error (no network call)', async () => {
      base('slack');
      const before = fakeHttp.seen.length;
      const outcome = await testChannelConnection('slack', {});
      expect(outcome.ok).to.equal(false);
      expect(outcome.errorCode).to.equal('client_error');
      expect(fakeHttp.seen.length).to.equal(before);
    });
  });

  // --- twilio-messaging / twilio-voice ---

  describe('twilio (REST Accounts.json, Basic auth)', () => {
    for (const apiType of ['twilio-messaging', 'twilio-voice'] as const) {
      it(`${apiType} 200 → ok:true`, async () => {
        base(apiType);
        fakeHttp.setStatus(200, JSON.stringify({ account_sid: 'AC123', friendly_name: 'Fake' }));
        const outcome = await testChannelConnection(apiType, { accountSid: 'AC123', authToken: 'token' });
        expect(outcome.ok).to.equal(true);
        expect(outcome.phase).to.equal('auth');
        const req = fakeHttp.seen.find((r) => r.path === '/2010-04-01/Accounts.json');
        expect(req).to.not.equal(undefined);
        expect(req!.auth).to.match(/^Basic /);
        // The Basic auth is accountSid:authToken base64-encoded.
        expect(Buffer.from(req!.auth!.slice('Basic '.length), 'base64').toString('utf8')).to.equal('AC123:token');
      });

      it(`${apiType} 401 → ok:false, errorCode auth`, async () => {
        base(apiType);
        fakeHttp.setStatus(401, JSON.stringify({ code: 20003, message: 'Authentication error' }));
        const outcome = await testChannelConnection(apiType, { accountSid: 'AC123', authToken: 'bad' });
        expect(outcome.ok).to.equal(false);
        expect(outcome.errorCode).to.equal('auth');
      });
    }
  });

  // --- whatsapp (Meta Graph API) ---

  describe('whatsapp (Meta Graph API)', () => {
    it('200 → ok:true (Bearer token)', async () => {
      base('whatsapp');
      fakeHttp.setStatus(200, JSON.stringify({ id: '12345', name: 'Fake' }));
      const outcome = await testChannelConnection('whatsapp', { phoneNumberId: '12345', accessToken: 'EAAG-token' });
      expect(outcome.ok).to.equal(true);
      const req = fakeHttp.seen.find((r) => r.path === '/12345');
      expect(req).to.not.equal(undefined);
      expect(req!.auth).to.equal('Bearer EAAG-token');
    });

    it('403 → ok:false, errorCode auth (invalid token)', async () => {
      base('whatsapp');
      fakeHttp.setStatus(403, JSON.stringify({ error: { message: 'Invalid OAuth access token.', code: 190 } }));
      const outcome = await testChannelConnection('whatsapp', { phoneNumberId: '12345', accessToken: 'BAD' });
      expect(outcome.ok).to.equal(false);
      expect(outcome.errorCode).to.equal('auth');
    });
  });

  // --- sendgrid ---

  describe('sendgrid (GET /api/v3/)', () => {
    it('200 → ok:true', async () => {
      base('sendgrid');
      fakeHttp.setStatus(200, JSON.stringify({ plan: 'free' }));
      const outcome = await testChannelConnection('sendgrid', { apiKey: 'SG.test-key' });
      expect(outcome.ok).to.equal(true);
      const req = fakeHttp.seen.find((r) => r.path === '/api/v3/');
      expect(req).to.not.equal(undefined);
      expect(req!.auth).to.equal('Bearer SG.test-key');
    });

    it('401 → ok:false, errorCode auth (bad key)', async () => {
      base('sendgrid');
      fakeHttp.setStatus(401, JSON.stringify({ errors: [{ message: 'Wrong credentials' }] }));
      const outcome = await testChannelConnection('sendgrid', { apiKey: 'SG.bad' });
      expect(outcome.ok).to.equal(false);
      expect(outcome.errorCode).to.equal('auth');
    });
  });

  // --- ses (AWS SDK ListIdentities) ---

  describe('ses (AWS SDK ListIdentities)', () => {
    it('200 → ok:true (SDK endpoint override, REST-XML response)', async () => {
      base('ses');
      fakeHttp.setStatus(
        200,
        '<ListIdentitiesResponse xmlns="http://ses.amazonaws.com/doc/2010-12-01/"><ListIdentitiesResult><Members><member>a@example.com</member></Members></ListIdentitiesResult><ResponseMetadata><RequestId>test</RequestId></ResponseMetadata></ListIdentitiesResponse>',
        'text/xml',
      );
      const outcome = await testChannelConnection('ses', { accessKeyId: 'AKIAFAKE', secretAccessKey: 'secret', region: 'us-east-1' });
      expect(outcome.ok).to.equal(true);
      expect(outcome.phase).to.equal('auth');
    });

    it('403 → ok:false, errorCode auth (UnrecognizedClientException / bad credentials)', async () => {
      base('ses');
      fakeHttp.setStatus(
        403,
        '<ErrorResponse><Error><Code>UnrecognizedClientException</Code><Message>The security token included in the request is invalid.</Message></Error><RequestId>test</RequestId></ErrorResponse>',
        'text/xml',
      );
      const outcome = await testChannelConnection('ses', { accessKeyId: 'AKIABAD', secretAccessKey: 'bad', region: 'us-east-1' });
      expect(outcome.ok).to.equal(false);
      expect(outcome.errorCode).to.equal('auth');
    });

    it('missing credentials → client_error (no network call)', async () => {
      base('ses');
      const outcome = await testChannelConnection('ses', { region: 'us-east-1' });
      expect(outcome.ok).to.equal(false);
      expect(outcome.errorCode).to.equal('client_error');
    });
  });

  // --- smtp-imap (raw socket) ---

  const smtpConfig = (overrides: Record<string, unknown> = {}) => ({
    fromAddress: 'test@example.com',
    smtp: {
      host: '127.0.0.1',
      port: fakeSmtp.port(),
      secure: false,
      auth: { user: 'smtp-user', pass: 'smtp-pass' },
      ...overrides.smtp,
    },
    ...overrides,
  });

  describe('smtp-imap (SMTP verify + IMAP LOGIN)', () => {
    it('SMTP AUTH ok, no IMAP → ok:true, detail { smtp: ok, imap: not-configured }', async () => {
      const outcome = await testChannelConnection('smtp-imap', smtpConfig());
      expect(outcome.ok).to.equal(true);
      expect(outcome.phase).to.equal('auth');
      expect(outcome.detail).to.deep.equal({ smtp: 'ok', imap: 'not-configured' });
      // The transcript has EHLO + AUTH PLAIN + QUIT — and NO MAIL FROM (zero side effects).
      const transcript = fakeSmtp.getTranscript();
      expect(transcript).to.match(/EHLO/i);
      expect(transcript).to.match(/AUTH PLAIN/);
      expect(transcript).to.not.match(/MAIL FROM/i);
      expect(transcript).to.not.match(/RCPT TO/i);
    });

    it('SMTP + IMAP both ok → ok:true, detail { smtp: ok, imap: ok }; IMAP LOGIN sent, no SELECT', async () => {
      const config = smtpConfig();
      (config as Record<string, unknown>).imap = { host: '127.0.0.1', port: fakeImap.port(), secure: false, auth: { user: 'imap-user', pass: 'imap-pass' } };
      const outcome = await testChannelConnection('smtp-imap', config);
      expect(outcome.ok).to.equal(true);
      expect(outcome.detail).to.deep.equal({ smtp: 'ok', imap: 'ok' });
      const imapTranscript = fakeImap.getTranscript();
      expect(imapTranscript).to.match(/A001 LOGIN/);
      expect(imapTranscript).to.not.match(/SELECT/i);
      expect(imapTranscript).to.not.match(/STORE/i);
    });

    it('SMTP wrong password → ok:false, errorCode auth', async () => {
      fakeSmtp.setAuthOk(false);
      const outcome = await testChannelConnection('smtp-imap', smtpConfig());
      expect(outcome.ok).to.equal(false);
      expect(outcome.errorCode).to.equal('auth');
      expect(outcome.detail).to.deep.equal({ smtp: 'error', imap: 'not-configured' });
    });

    it('IMAP wrong password → ok:false, errorCode auth, detail { smtp: ok, imap: error }', async () => {
      fakeImap.setLoginOk(false);
      const config = smtpConfig();
      (config as Record<string, unknown>).imap = { host: '127.0.0.1', port: fakeImap.port(), secure: false, auth: { user: 'imap-user', pass: 'bad' } };
      const outcome = await testChannelConnection('smtp-imap', config);
      expect(outcome.ok).to.equal(false);
      expect(outcome.errorCode).to.equal('auth');
      expect(outcome.detail).to.deep.equal({ smtp: 'ok', imap: 'error' });
    });

    it('unreachable SMTP → network/timeout code (not auth)', async () => {
      const config = smtpConfig({ smtp: { host: '127.0.0.1', port: 1, secure: false, auth: { user: 'u', pass: 'p' } } });
      const outcome = await testChannelConnection('smtp-imap', config);
      expect(outcome.ok).to.equal(false);
      expect(['network', 'timeout']).to.include(outcome.errorCode);
    });
  });

  // --- dispatcher ---

  describe('dispatcher', () => {
    it('exposes all eight channel apiTypes', () => {
      expect(CHANNEL_API_TYPES.sort()).to.deep.equal(['sendgrid', 'ses', 'slack', 'smtp-imap', 'telegram', 'twilio-messaging', 'twilio-voice', 'whatsapp']);
    });

    it('unknown apiType → throws (the tester maps to 400)', async () => {
      try {
        await testChannelConnection('does-not-exist', {});
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('does-not-exist');
      }
    });
  });

  // --- full tester: protocol + SUPPORTED_TYPES ---

  describe('tester integration (protocol + channel type)', () => {
    it('telegram channel → protocol http, phase auth, ok (via the full tester)', async () => {
      base('telegram');
      fakeHttp.setStatus(200, JSON.stringify({ ok: true, result: { id: 1, is_bot: true, first_name: 'TestBot', username: 'testbot' } }));
      const tester = new TestTester();
      tester.providers.set('prov_channel_1', savedChannelProvider());

      const result = await tester.testConnection({ providerId: 'prov_channel_1' }, context);
      expect(result.ok).to.equal(true);
      expect(result.providerType).to.equal('channel');
      expect(result.apiType).to.equal('telegram');
      expect(result.protocol).to.equal('http');
      expect(result.phase).to.equal('auth');

      // Saved mode: one channel.test row; breaker not fed (TPC-01 guard).
      await sharedCallLogger.flushNow();
      expect(sharedCallLogger.rows).to.have.length(1);
      expect(sharedCallLogger.rows[0].operation).to.equal('channel.test');
      expect(sharedBreakers.successes).to.be.empty;
    });

    it('ses channel → protocol sdk; smtp-imap channel → protocol smtp', async () => {
      const tester = new TestTester();
      // ses → protocol 'sdk' (even for a client_error, the protocol is set).
      tester.providers.set('prov_channel_1', savedChannelProvider({ id: 'prov_channel_1', apiType: 'ses', config: { region: 'us-east-1' } as Provider['config'] }));
      const sesResult = await tester.testConnection({ providerId: 'prov_channel_1' }, context);
      expect(sesResult.protocol).to.equal('sdk');
      expect(sesResult.ok).to.equal(false); // missing credentials

      // smtp-imap → protocol 'smtp'.
      const smtpConfig = {
        fromAddress: 'test@example.com',
        smtp: { host: '127.0.0.1', port: fakeSmtp.port(), secure: false, auth: { user: 'smtp-user', pass: 'smtp-pass' } },
      };
      tester.providers.set('prov_channel_2', savedChannelProvider({ id: 'prov_channel_2', apiType: 'smtp-imap', config: smtpConfig as Provider['config'] }));
      const smtpResult = await tester.testConnection({ providerId: 'prov_channel_2' }, context);
      expect(smtpResult.protocol).to.equal('smtp');
      expect(smtpResult.ok).to.equal(true);
    });
  });
});

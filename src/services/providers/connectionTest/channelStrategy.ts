import * as nodemailer from 'nodemailer';
import * as net from 'node:net';
import * as tls from 'node:tls';
import type { ConnectionTestOutcome, TestPhase } from './types';
import { classifyThirdPartyError, type ThirdPartyErrorCode } from '../../../utils/errorClassification';

/**
 * TPC-08 — channel provider connection tests.
 *
 * Channels have no provider *class* (the files under `services/providers/
 * channel/` are config schemas only; the real connection logic lives in
 * `src/channels/`), so there is no base-class `testConnection()` to own.
 * Instead each apiType has a sub-strategy here that verifies
 * credentials/availability **over the provider's own protocol** with zero
 * side effects — a single free, read-only vendor call (or SMTP `EHLO`/`AUTH`/
 * `QUIT`, IMAP `LOGIN`/`LOGOUT`). A channel test that would send anything is
 * a defect.
 *
 * The base URLs default to each vendor's production endpoint; the test seam
 * (`setChannelApiBaseForTests`) overrides them so unit tests run against a
 * local fake server (no external network). The SES sub-strategy overrides the
 * AWS SDK `endpoint` the same way.
 */

/** Default vendor base URLs (production). `ses` is region-derived by the SDK when empty. */
const CHANNEL_API_BASE: Record<string, string> = {
  telegram: 'https://api.telegram.org',
  'twilio-messaging': 'https://api.twilio.com',
  'twilio-voice': 'https://api.twilio.com',
  whatsapp: 'https://graph.facebook.com/v17.0',
  sendgrid: 'https://api.sendgrid.com',
  ses: '',
};

/**
 * Test seam: override the API base/endpoint per apiType (tests use a local
 * fake server). Backed by `globalThis` so it crosses the tsx/ESM-vs-CJS module
 * graph boundary — the e2e world (test world) can point the app-world channel
 * strategy at a local server without importing the app-world module.
 */
const CHANNEL_API_BASE_SEAM = '__TEST_CHANNEL_API_BASE__';
function seamOverrides(): Record<string, string> {
  const g = globalThis as Record<string, unknown>;
  if (typeof g[CHANNEL_API_BASE_SEAM] !== 'object' || g[CHANNEL_API_BASE_SEAM] === null) {
    g[CHANNEL_API_BASE_SEAM] = {};
  }
  return g[CHANNEL_API_BASE_SEAM] as Record<string, string>;
}
export function setChannelApiBaseForTests(apiType: string, baseUrl: string): () => void {
  seamOverrides()[apiType] = baseUrl;
  return () => delete seamOverrides()[apiType];
}
export function resetChannelApiBasesForTests(): void {
  (globalThis as Record<string, unknown>)[CHANNEL_API_BASE_SEAM] = {};
}
function baseUrlFor(apiType: string): string {
  return seamOverrides()[apiType] ?? CHANNEL_API_BASE[apiType] ?? '';
}

const str = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value));

/**
 * A single HTTP credential check (the "same protocol" for the REST channels):
 * 2xx → ok; 401/403 → auth; other non-2xx → client/server error; a network
 * failure (DNS/refused/timeout) → the classified network/timeout code.
 * `phase` is always 'auth' — the furthest stage a credential check reaches.
 */
async function httpCheck(apiType: string, path: string, init: RequestInit): Promise<ConnectionTestOutcome> {
  const url = `${baseUrlFor(apiType)}${path}`;
  try {
    const res = await fetch(url, init);
    if (res.ok) {
      return { ok: true, phase: 'auth', errorCode: null, statusHttp: res.status };
    }
    let body = '';
    try {
      body = (await res.text()).slice(0, 300);
    } catch {
      /* non-text body — ignore */
    }
    const code: ThirdPartyErrorCode = res.status === 401 || res.status === 403 ? 'auth' : res.status >= 500 ? 'server_error' : 'client_error';
    return { ok: false, phase: 'auth', errorCode: code, statusHttp: res.status, errorText: `HTTP ${res.status}: ${body}`.trim() };
  } catch (err) {
    const classified = classifyThirdPartyError(err);
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, phase: 'auth', errorCode: classified.code, errorText: message };
  }
}

/** telegram — Bot API `getMe` (1 free call). */
async function testTelegram(config: Record<string, unknown>): Promise<ConnectionTestOutcome> {
  const botToken = str(config.botToken);
  if (!botToken) return { ok: false, phase: 'auth', errorCode: 'client_error', errorText: 'Missing botToken' };
  return httpCheck('telegram', `/bot${botToken}/getMe`, { method: 'GET', headers: { Accept: 'application/json' } });
}

/** twilio-messaging / twilio-voice — REST `GET /2010-04-01/Accounts.json` (1 free call, Basic auth). */
async function testTwilio(apiType: string, config: Record<string, unknown>): Promise<ConnectionTestOutcome> {
  const accountSid = str(config.accountSid);
  const authToken = str(config.authToken);
  if (!accountSid || !authToken) return { ok: false, phase: 'auth', errorCode: 'client_error', errorText: 'Missing accountSid/authToken' };
  const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
  return httpCheck(apiType, '/2010-04-01/Accounts.json', { method: 'GET', headers: { Authorization: auth, Accept: 'application/json' } });
}

/** whatsapp — Meta Graph API `GET /{phoneNumberId}` (1 free call, Bearer token). */
async function testWhatsApp(config: Record<string, unknown>): Promise<ConnectionTestOutcome> {
  const phoneNumberId = str(config.phoneNumberId);
  const accessToken = str(config.accessToken);
  if (!phoneNumberId || !accessToken) return { ok: false, phase: 'auth', errorCode: 'client_error', errorText: 'Missing phoneNumberId/accessToken' };
  return httpCheck('whatsapp', `/${phoneNumberId}`, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
}

/** sendgrid — `GET /api/v3/` (account info; 401 on bad key, 1 free call). */
async function testSendGrid(config: Record<string, unknown>): Promise<ConnectionTestOutcome> {
  const apiKey = str(config.apiKey);
  if (!apiKey) return { ok: false, phase: 'auth', errorCode: 'client_error', errorText: 'Missing apiKey' };
  return httpCheck('sendgrid', '/api/v3/', { method: 'GET', headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
}

/** ses — SES `ListIdentities` (1 free call, no side effects) via the AWS SDK. The codebase uses SESv1, so the credential check uses SESv1 (not the spec's SESv2 `GetAccount`). */
async function testSes(config: Record<string, unknown>): Promise<ConnectionTestOutcome> {
  const accessKeyId = str(config.accessKeyId);
  const secretAccessKey = str(config.secretAccessKey);
  const region = str(config.region) || 'us-east-1';
  if (!accessKeyId || !secretAccessKey) {
    return { ok: false, phase: 'auth', errorCode: 'client_error', errorText: 'Missing accessKeyId/secretAccessKey' };
  }
  const { SESClient, ListIdentitiesCommand } = await import('@aws-sdk/client-ses');
  const endpoint = baseUrlFor('ses');
  const client = new SESClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
    ...(endpoint ? { endpoint } : {}),
  });
  try {
    await client.send(new ListIdentitiesCommand({}));
    return { ok: true, phase: 'auth', errorCode: null };
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    const name = e?.name ?? '';
    const httpStatus = e?.$metadata?.httpStatusCode;
    const message = err instanceof Error ? err.message : String(err);
    if (httpStatus === 401 || httpStatus === 403 || name === 'UnrecognizedClientException' || name === 'InvalidClientTokenId' || name === 'InvalidSignatureException' || name === 'AccessDeniedException') {
      return { ok: false, phase: 'auth', errorCode: 'auth', errorText: `SES auth failed: ${name || `HTTP ${httpStatus}`}: ${message}` };
    }
    const classified = classifyThirdPartyError(err);
    return { ok: false, phase: 'auth', errorCode: classified.code, errorText: message };
  } finally {
    await client.destroy();
  }
}

/**
 * smtp-imap — two phases, both optional (SMTP is required, IMAP optional):
 * - SMTP: `nodemailer` `verify()` — connect → EHLO → AUTH (PLAIN/LOGIN per config) → QUIT. **No MAIL FROM, no message sent.**
 * - IMAP: raw socket → `LOGIN` → `LOGOUT`. No folders opened, no flags set.
 * `phase` is the furthest reached; `detail` reports each phase's outcome.
 */
const SMTP_IMAP_SOCKET_TIMEOUT_MS = 10_000;

async function smtpPhase(smtp: Record<string, unknown>): Promise<{ ok: boolean; phase: TestPhase; errorCode: ThirdPartyErrorCode | null; errorText?: string }> {
  const host = str(smtp.host);
  const port = Number(smtp.port);
  const secure = smtp.secure === true;
  const auth = (smtp.auth ?? {}) as Record<string, unknown>;
  const user = str(auth.user);
  const pass = str(auth.pass);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, phase: 'auth', errorCode: 'client_error', errorText: 'SMTP host/port missing or invalid' };
  }
  if (!user || !pass) return { ok: false, phase: 'auth', errorCode: 'client_error', errorText: 'SMTP auth user/pass missing' };
  const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass }, tls: { rejectUnauthorized: true } });
  try {
    // verify() = connect → EHLO → AUTH (if configured) → QUIT. No MAIL FROM.
    await transporter.verify();
    return { ok: true, phase: 'auth', errorCode: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/invalid login|authentication failed|auth fail|login attempt failed|code: 535/i.test(message)) {
      return { ok: false, phase: 'auth', errorCode: 'auth', errorText: `SMTP AUTH failed: ${message}` };
    }
    const classified = classifyThirdPartyError(err);
    return { ok: false, phase: 'auth', errorCode: classified.code, errorText: `SMTP ${classified.code}: ${message}` };
  } finally {
    await transporter.close();
  }
}

/** Quote an IMAP string argument (double-quoted, with embedded `"` and `\\` escaped). */
function imapQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * IMAP credential check over a raw socket: connect → (greeting) → `LOGIN` →
 * `LOGOUT`. Same protocol the production `imap` client uses; no folders
 * opened, no flags set. `secure` = implicit TLS (default, port 993); otherwise
 * plain TCP (the STARTTLS upgrade is a server config, not a credential check).
 */
async function imapPhase(imap: Record<string, unknown>): Promise<{ ok: boolean; phase: TestPhase; errorCode: ThirdPartyErrorCode | null; errorText?: string }> {
  const host = str(imap.host);
  const port = Number(imap.port);
  const secure = imap.secure !== false; // default true (implicit TLS on 993)
  const auth = (imap.auth ?? {}) as Record<string, unknown>;
  const user = str(auth.user);
  const pass = str(auth.pass);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, phase: 'auth', errorCode: 'client_error', errorText: 'IMAP host/port missing or invalid' };
  }
  if (!user || !pass) return { ok: false, phase: 'auth', errorCode: 'client_error', errorText: 'IMAP auth user/pass missing' };

  return await new Promise((resolve) => {
    const socket = secure ? tls.connect({ host, port, rejectUnauthorized: true }) : net.connect({ host, port });
    let buffer = '';
    let stage: 'greeting' | 'login' = 'greeting';
    let settled = false;
    const finish = (outcome: { ok: boolean; phase: TestPhase; errorCode: ThirdPartyErrorCode | null; errorText?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.end();
      } catch {
        /* already closed */
      }
      socket.destroy();
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ ok: false, phase: 'auth', errorCode: 'timeout', errorText: 'IMAP connect/auth timed out' }), SMTP_IMAP_SOCKET_TIMEOUT_MS);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (stage === 'greeting' && line.startsWith('* OK')) {
          stage = 'login';
          socket.write(`A001 LOGIN ${imapQuote(user)} ${imapQuote(pass)}\r\n`);
        } else if (stage === 'login' && line.startsWith('A001 OK')) {
          socket.write('A002 LOGOUT\r\n');
          finish({ ok: true, phase: 'auth', errorCode: null });
        } else if (stage === 'login' && (line.startsWith('A001 NO') || line.startsWith('A001 BAD'))) {
          finish({ ok: false, phase: 'auth', errorCode: 'auth', errorText: `IMAP LOGIN failed: ${line.trim()}` });
        }
      }
    });
    socket.on('error', (err) => {
      const classified = classifyThirdPartyError(err);
      finish({ ok: false, phase: 'auth', errorCode: classified.code, errorText: `IMAP ${classified.code}: ${err.message}` });
    });
  });
}

async function testSmtpImap(config: Record<string, unknown>): Promise<ConnectionTestOutcome> {
  const smtp = (config.smtp ?? {}) as Record<string, unknown>;
  const imap = (config.imap ?? null) as Record<string, unknown> | null;

  const smtpResult = await smtpPhase(smtp);
  if (!smtpResult.ok) {
    return { ok: false, phase: smtpResult.phase, errorCode: smtpResult.errorCode, errorText: smtpResult.errorText, detail: { smtp: 'error', imap: imap ? 'skipped' : 'not-configured' } };
  }
  if (!imap) {
    return { ok: true, phase: 'auth', errorCode: null, detail: { smtp: 'ok', imap: 'not-configured' } };
  }
  const imapResult = await imapPhase(imap);
  if (!imapResult.ok) {
    return { ok: false, phase: imapResult.phase, errorCode: imapResult.errorCode, errorText: imapResult.errorText, detail: { smtp: 'ok', imap: 'error' } };
  }
  return { ok: true, phase: 'auth', errorCode: null, detail: { smtp: 'ok', imap: 'ok' } };
}

/** Sub-strategies keyed by apiType. */
const CHANNEL_SUBSTRATEGIES: Record<string, (config: Record<string, unknown>) => Promise<ConnectionTestOutcome>> = {
  telegram: (config) => testTelegram(config),
  'twilio-messaging': (config) => testTwilio('twilio-messaging', config),
  'twilio-voice': (config) => testTwilio('twilio-voice', config),
  whatsapp: (config) => testWhatsApp(config),
  sendgrid: (config) => testSendGrid(config),
  ses: (config) => testSes(config),
  'smtp-imap': (config) => testSmtpImap(config),
};

export const CHANNEL_API_TYPES = Object.keys(CHANNEL_SUBSTRATEGIES);

/**
 * Dispatch a channel connection test by apiType. A missing sub-strategy is a
 * configuration error (`InvalidOperationError`-class), not a crash — the
 * caller (tester) maps it to 400.
 */
export async function testChannelConnection(apiType: string, config: Record<string, unknown>): Promise<ConnectionTestOutcome> {
  const strategy = CHANNEL_SUBSTRATEGIES[apiType];
  if (!strategy) {
    throw new Error(`No channel connection test available for apiType '${apiType}'. Supported: ${CHANNEL_API_TYPES.join(', ')}`);
  }
  return strategy(config);
}

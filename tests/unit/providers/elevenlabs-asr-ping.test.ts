import 'reflect-metadata';
import { describe, it } from 'mocha';
import { expect } from 'chai';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { ElevenLabsAsrProvider, elevenLabsAsrSettingsSchema } from '../../../src/services/providers/asr/ElevenLabsAsrProvider';

/**
 * ElevenLabs ASR liveness probe must use the realtime WebSocket handshake —
 * the same auth/permission path as live transcription — not a REST endpoint.
 *
 * Background: GET /v1/models (the old probe) requires the `models_read`
 * permission. Keys restricted to ASR-only return 401 for it even though
 * transcription works, so the health check reported a healthy key as down.
 * A zero-cost handshake (open + session_started, no audio) verifies exactly
 * what the provider will actually use.
 *
 * The provider is pointed at a local mock of the realtime endpoint via the
 * overridable `realtimeWsUrl`.
 */

type Behavior = 'ok' | 'auth-rejected' | 'no-session';

function startMockRealtimeServer(
  behavior: Behavior,
): Promise<{ port: number; receivedKeys: string[]; close: () => Promise<void> }> {
  const receivedKeys: string[] = [];
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const port = (wss.address() as AddressInfo).port;
      resolve({ port, receivedKeys, close: () => new Promise((r) => wss.close(() => r())) });
    });
    wss.on('connection', (socket, req) => {
      receivedKeys.push(String(req.headers['xi-api-key'] ?? ''));
      if (behavior === 'ok') {
        socket.send(JSON.stringify({ message_type: 'session_started', session_id: 'mock-session' }));
      } else if (behavior === 'auth-rejected') {
        socket.close(4401, 'invalid api key');
      } else {
        socket.send(JSON.stringify({ message_type: 'invalid_request', error: "The model_id 'x' is invalid" }));
        socket.close(1008, 'invalid_request');
      }
    });
  });
}

function createProbeProvider(wsUrl: string): ElevenLabsAsrProvider {
  const provider = new ElevenLabsAsrProvider({ apiKey: 'test-key' }, elevenLabsAsrSettingsSchema.parse({}));
  provider.realtimeWsUrl = wsUrl;
  return provider;
}

describe('ElevenLabsAsrProvider ping (realtime handshake probe)', () => {
  it('sends the xi-api-key header and resolves on session_started', async function () {
    this.timeout(10_000);
    const mock = await startMockRealtimeServer('ok');
    try {
      const provider = createProbeProvider(`ws://127.0.0.1:${mock.port}/v1/speech-to-text/realtime`);
      await provider.ping();
      expect(mock.receivedKeys).to.deep.equal(['test-key']);
    } finally {
      await mock.close();
    }
  });

  it('rejects with the close code when the endpoint rejects the key', async function () {
    this.timeout(10_000);
    const mock = await startMockRealtimeServer('auth-rejected');
    try {
      const provider = createProbeProvider(`ws://127.0.0.1:${mock.port}/v1/speech-to-text/realtime`);
      let error: unknown = null;
      try {
        await provider.ping();
      } catch (err) {
        error = err;
      }
      expect(error, 'ping should reject').to.be.instanceOf(Error);
      expect((error as Error).message).to.include('4401');
    } finally {
      await mock.close();
    }
  });

  it('rejects when the endpoint closes without session_started (e.g. invalid model)', async function () {
    this.timeout(10_000);
    const mock = await startMockRealtimeServer('no-session');
    try {
      const provider = createProbeProvider(`ws://127.0.0.1:${mock.port}/v1/speech-to-text/realtime`);
      let error: unknown = null;
      try {
        await provider.ping();
      } catch (err) {
        error = err;
      }
      expect(error, 'ping should reject').to.be.instanceOf(Error);
      expect((error as Error).message).to.include('1008');
    } finally {
      await mock.close();
    }
  });
});

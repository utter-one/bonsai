import { container } from 'tsyringe';
import type { IAsrProvider } from '../../asr/IAsrProvider';
import { AsrProviderFactory } from '../../asr/AsrProviderFactory';
import type { ConnectionTestContext, ConnectionTestOutcome, ConnectionTestRequest, ConnectionTestStrategy } from '../types';
import { buildAsrSilence } from '../silence';

/** Hard timeout for the whole ASR test body (TPC-01 guard table). */
const ASR_TEST_TIMEOUT_MS = 20_000;

/** Fresh per-test state built by the strategy (the tester bounds cleanup on it). */
export interface AsrTestInstance {
  asr: IAsrProvider;
  /** Delegates to the provider (the tester's boundedCleanup calls instance.cleanup). */
  cleanup(): Promise<void>;
}

/**
 * ASR connection strategy (TPC-03): verify auth + availability by opening a
 * real streaming session over the provider's WebSocket data plane and feeding
 * it ~500 ms of silence — the exact lifecycle a conversation turn runs:
 * init → start → sendAudio(silence) → await session-live signal → stop
 * (cleanup is the tester's job, always awaited).
 *
 * All six apiTypes are covered by construction (deepgram, elevenlabs,
 * speechmatics, assemblyai, soniox, azure — all WS-based); the strategy
 * contains no per-vendor code. Vendor failures escape as raw errors and are
 * classified by the tester (auth / rate_limited / network / server_error /
 * timeout).
 *
 * Session-live signal: the recognition-started callback, the first
 * partial/final transcript, or a fatal error — whichever comes first. The
 * listeners are registered BEFORE start(): some providers (e.g. Deepgram on
 * WS open) fire onRecognitionStarted during start(), and a transcript partial
 * is never required (silence yields no text); if one arrives it is reported
 * in `detail.transcript` as a bonus signal.
 *
 * The production wrapper records the test's own `asr.session` call-log row
 * (flushed at stop/cleanup, breaker-excluded via the tester's monitoring
 * context); draft instances are un-stamped and record nothing.
 */
export function buildAsrConnectionTestStrategy(): ConnectionTestStrategy<AsrTestInstance> {
  return {
    providerType: 'asr',
    timeoutMs: ASR_TEST_TIMEOUT_MS,
    protocol: 'websocket',

    async buildInstance(request: ConnectionTestRequest, _ctx: ConnectionTestContext): Promise<AsrTestInstance> {
      const factory = container.resolve(AsrProviderFactory);
      // No init() here — the lifecycle below is the test, and an init failure
      // must surface as a classified test result, not a build error.
      const asr = await factory.createForTest(request.provider, {});
      return { asr, cleanup: () => asr.cleanup() };
    },

    async test(request: ConnectionTestRequest, instance: AsrTestInstance, _ctx: ConnectionTestContext): Promise<ConnectionTestOutcome> {
      const { asr } = instance;
      const formats = asr.getSupportedInputFormats();
      const format = formats[0];
      if (!format) {
        // Defensive — every shipped ASR provider declares at least one format.
        throw new Error('ASR provider declares no supported input formats');
      }

      let transcript = '';
      const sessionLive = new Promise<void>((resolve, reject) => {
        let settled = false;
        const ok = (): void => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        // ErrorCallback contract: (error) => Promise<void>.
        const fail = (err: Error): Promise<void> => {
          if (!settled) {
            settled = true;
            reject(err);
          }
          return Promise.resolve();
        };
        asr.setOnRecognitionStarted(ok);
        asr.setOnRecognizing((_chunkId, text) => {
          transcript += text;
          ok();
        });
        asr.setOnRecognized((_chunkId, text) => {
          transcript += text;
          ok();
        });
        asr.setOnError(fail);
      });

      // The production wrapper (AsrProviderBase.start/sendAudio/stop) runs the
      // session lifecycle and records the `asr.session` row — the same path a
      // conversation turn uses.
      await asr.init();
      await asr.start(); // WS/session established — auth accepted (phase: auth)
      await asr.sendAudio(buildAsrSilence(format));
      await sessionLive; // server confirmed the session / accepted the audio (phase: first-data)

      await asr.stop();
      return {
        ok: true,
        providerType: request.providerType,
        apiType: request.apiType,
        protocol: 'websocket',
        phase: 'first-data',
        latencyMs: 0, // tester-owned (total elapsed) — placeholder for the internal shape
        errorCode: null,
        ...(transcript ? { detail: { transcript } } : {}),
      };
    },
  };
}

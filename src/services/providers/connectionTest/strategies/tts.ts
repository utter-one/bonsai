import { container } from 'tsyringe';
import type { GeneratedAudioChunk, ITtsProvider } from '../../tts/ITtsProvider';
import { TtsProviderFactory, type TtsSettings } from '../../tts/TtsProviderFactory';
import type { ConnectionTestContext, ConnectionTestOutcome, ConnectionTestRequest, ConnectionTestStrategy, TestProtocol } from '../types';

/** Hard timeout for the whole TTS test body (TPC-01 guard table). */
const TTS_TEST_TIMEOUT_MS = 30_000;

/** The fixed minimum-size test text (2–3 words, one sentence). */
const TTS_TEST_TEXT = 'Test connection.';

/**
 * Transport per apiType (TPC-04): the strategy reports the same protocol the
 * provider's main functionality uses. A table — no per-vendor code paths.
 */
const TTS_PROTOCOL_BY_API_TYPE: Record<string, TestProtocol> = {
  elevenlabs: 'websocket',
  deepgram: 'websocket',
  cartesia: 'websocket',
  openai: 'http',
  soniox: 'sdk',
  'amazon-polly': 'sdk',
  azure: 'sdk',
};

/** Fresh per-test state built by the strategy (the tester bounds cleanup on it). */
export interface TtsTestInstance {
  tts: ITtsProvider;
  /** The voice input param, if any (null → the provider's own default). */
  voice: string | null;
  /** Delegates to the provider (the tester's boundedCleanup calls instance.cleanup). */
  cleanup(): Promise<void>;
}

/**
 * TTS connection strategy (TPC-04): verify auth + availability (and
 * voice/model validity) with the provider's production streaming synthesis
 * lifecycle on a 2–3 word test string — the same transport, session and
 * callbacks a conversation turn uses. Audio chunks are counted, never
 * persisted, returned, or played.
 *
 * All 7 apiTypes are covered by construction — the factory maps them, the
 * strategy contains no per-vendor code. `ok` = at least one audio chunk
 * received (proves the full round trip: auth, voice/model validity,
 * streaming delivery). Zero chunks after a clean stream end → structured
 * `ok:false, errorCode 'server_error'`. Vendor errors escape raw (or via the
 * provider's error callback) and are classified by the tester (auth /
 * rate_limited / network / server_error / timeout). The production wrapper
 * records the test's own `tts.session` call-log row under the tester's
 * monitoring context (breaker-excluded); draft instances are un-stamped and
 * record nothing.
 *
 * Voice: the `voice` input param, else the provider's own default (e.g.
 * OpenAI 'alloy'); providers that require an explicit voice fail the
 * lifecycle with their own error, which the tester classifies.
 */
export function buildTtsConnectionTestStrategy(): ConnectionTestStrategy<TtsTestInstance> {
  return {
    providerType: 'tts',
    timeoutMs: TTS_TEST_TIMEOUT_MS,
    protocol: 'http',

    async buildInstance(request: ConnectionTestRequest, _ctx: ConnectionTestContext): Promise<TtsTestInstance> {
      const factory = container.resolve(TtsProviderFactory);
      // Every TTS settings schema requires the `provider` literal (== apiType);
      // all other fields take schema defaults. No init() here — the lifecycle
      // below is the test, and an init failure must surface as a classified
      // test result, not a build error.
      const settings = { provider: request.apiType, voiceId: request.voice } as TtsSettings;
      const tts = await factory.createForTest(request.provider, settings);
      return { tts, voice: request.voice ?? null, cleanup: () => tts.cleanup() };
    },

    async test(request: ConnectionTestRequest, instance: TtsTestInstance, _ctx: ConnectionTestContext): Promise<ConnectionTestOutcome> {
      const { tts } = instance;
      const protocol = TTS_PROTOCOL_BY_API_TYPE[request.apiType] ?? 'http';

      // Audio is counted only — dropped immediately, never buffered, persisted,
      // returned, or played.
      let bytes = 0;
      let vendorError: Error | null = null;
      // Some providers (e.g. ElevenLabs WS) deliver audio only AFTER end()
      // returns (EOS is fire-and-send), so completion = the provider's own
      // generation-ended signal (OpenAI: after its request queue + final
      // flush; ElevenLabs: on stream close). The hard timeout bounds this wait.
      let resolveEnded: () => void = () => undefined;
      const ended = new Promise<void>((resolve) => {
        resolveEnded = resolve;
      });

      tts.setOnSpeechGenerating((chunk: GeneratedAudioChunk) => {
        bytes += chunk.audio.length; // counted, then discarded — never persisted
        return Promise.resolve();
      });
      tts.setOnError((err) => {
        vendorError = err;
        return Promise.resolve();
      });
      tts.setOnGenerationEnded(() => {
        resolveEnded();
        return Promise.resolve();
      });

      // The production wrapper (TtsProviderBase.init/start/sendText/end) runs
      // the session lifecycle and records the `tts.session` row — the same
      // path a conversation turn uses.
      await tts.init();
      await tts.start();
      await tts.sendText(TTS_TEST_TEXT);
      await tts.end();
      await ended;

      // Vendor failures surface through the provider's error callback (the
      // base wrapper swallows them there) — re-throw so the tester classifies.
      if (vendorError) {
        throw vendorError;
      }
      if (bytes === 0) {
        // Clean stream end with no audio: auth and the session worked, but
        // the round trip produced nothing (bad voice/model, or an upstream
        // failure the provider swallowed). Data, not an HTTP error.
        return {
          ok: false,
          providerType: request.providerType,
          apiType: request.apiType,
          protocol,
          phase: 'session',
          latencyMs: 0, // tester-owned (total elapsed)
          errorCode: 'server_error',
          statusHttp: null,
          errorText: `TTS stream ended without producing any audio (voice: ${instance.voice ?? 'provider default'})`,
          model: instance.voice,
        };
      }
      return {
        ok: true,
        providerType: request.providerType,
        apiType: request.apiType,
        protocol,
        phase: 'first-data',
        latencyMs: 0, // tester-owned (total elapsed)
        errorCode: null,
        statusHttp: null,
        model: instance.voice,
        detail: { voice: instance.voice, bytes },
      };
    },
  };
}

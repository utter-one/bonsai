/**
 * P3-04: failover wrappers for TTS / ASR / storage.
 *
 * Pure unit tests — the wrappers are driven with fake provider instances
 * (plain objects implementing the interfaces) and fake monitoring deps.
 * Real call-log attribution (base classes + `fallback_provider_id`) is
 * covered in the e2e suite.
 */
import { expect } from 'chai';
import 'reflect-metadata';
import type { SimpleCallback, ErrorCallback } from '../../../src/types/callbacks';
import type { AudioFormat } from '../../../src/types/audio';
import type { GeneratedAudioChunk, ITtsProvider, SpeechGenerationCallback } from '../../../src/services/providers/tts/ITtsProvider';
import type { IAsrProvider, TextChunk, TextRecognitionCallback } from '../../../src/services/providers/asr/IAsrProvider';
import type { IStorageProvider, StorageObject } from '../../../src/services/providers/storage/IStorageProvider';
import { FailoverTtsProvider } from '../../../src/services/providers/tts/FailoverTtsProvider';
import { FailoverAsrProvider } from '../../../src/services/providers/asr/FailoverAsrProvider';
import { FailoverStorageProvider } from '../../../src/services/providers/storage/FailoverStorageProvider';
import { CircuitOpenError } from '../../../src/errors';
import type { TtsProviderFactory, TtsSettings } from '../../../src/services/providers/tts/TtsProviderFactory';
import type { AsrProviderFactory } from '../../../src/services/providers/asr/AsrProviderFactory';
import type { StorageProviderFactory } from '../../../src/services/providers/storage/StorageProviderFactory';
import type { FallbackStep } from '../../../src/services/providers/FallbackResolver';
import type { ProviderRow } from '../../../src/services/providers/FallbackResolver';
import type { CircuitBreakerRegistry } from '../../../src/services/monitoring/CircuitBreakerRegistry';
import type { FallbackEventService } from '../../../src/services/monitoring/FallbackEventService';
import type { MetricsRegistry } from '../../../src/services/monitoring/MetricsRegistry';

// --- fakes ---

class FakeMetrics {
  increments: Array<{ name: string; labels: Record<string, unknown> }> = [];
  inc(name: string, labels: Record<string, unknown> = {}): void {
    this.increments.push({ name, labels });
  }
  count(name: string, labels: Record<string, unknown> = {}): number {
    return this.increments.filter((i) => i.name === name && JSON.stringify(i.labels) === JSON.stringify(labels)).length;
  }
}

class FakeFallbackEvents {
  recorded: Array<Record<string, unknown>> = [];
  succeeded: string[] = [];
  private n = 0;
  async record(input: Record<string, unknown>): Promise<{ id: string } | null> {
    this.n += 1;
    const id = `row_${this.n}`;
    this.recorded.push({ id, ...input });
    return { id };
  }
  async markSucceeded(id: string): Promise<void> {
    this.succeeded.push(id);
  }
}

type BreakerState = 'closed' | 'open' | 'half-open' | null;

class FakeBreakerRegistry {
  states = new Map<string, BreakerState>();
  constructor(states: Record<string, Exclude<BreakerState, null>>) {
    for (const [id, state] of Object.entries(states)) this.states.set(id, state);
  }
  getState(id: string): BreakerState {
    return this.states.get(id) ?? null;
  }
  getBreaker(id: string): { beforeCall(): void } {
    const registry = this;
    return {
      beforeCall(): void {
        const state = registry.states.get(id);
        if (state === 'open' || state === 'half-open') throw new CircuitOpenError(id);
      },
    };
  }
}

/** Returns the rejection, or throws if the promise resolved. */
async function rejects(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

function providerRow(id: string): ProviderRow {
  return { id, version: 1 } as unknown as ProviderRow;
}

function step(id: string, settings?: Record<string, unknown>): FallbackStep {
  return { provider: providerRow(id), settings };
}

// classifyThirdPartyError maps undici's UND_ERR_* timeout codes to 'timeout'.
function timeoutError(): Error {
  const e = new Error('connect timeout');
  (e as NodeJS.ErrnoException).code = 'UND_ERR_CONNECT_TIMEOUT';
  return e;
}

function serverError(): Error {
  const e = new Error('boom');
  e.status = 503;
  return e;
}

function authError(): Error {
  const e = new Error('unauthorized');
  e.status = 401;
  return e;
}

function makeError(code: 'timeout' | 'server_error' | 'auth'): Error {
  if (code === 'timeout') return timeoutError();
  if (code === 'server_error') return serverError();
  return authError();
}

// --- TTS fakes ---

class FakeTts {
  format: AudioFormat;
  initImpl: () => Promise<void> = async () => {};
  startImpl: (() => Promise<void>) | Error = async () => {};
  sendTextImpl: ((text: string) => Promise<void>) | Error = async () => {};
  endImpl: (() => Promise<void>) | Error = async () => {};
  texts: string[] = [];
  startCalls = 0;
  initCalls = 0;
  endCalls = 0;
  cancelCalls = 0;
  cleanupCalls = 0;
  fallbackOf: string | null = null;
  speechCb?: SpeechGenerationCallback<GeneratedAudioChunk>;
  errorCb?: ErrorCallback;
  startedCb?: SimpleCallback;
  endedCb?: SimpleCallback;

  constructor(format: AudioFormat = 'mp3') {
    this.format = format;
  }

  async init(): Promise<void> {
    this.initCalls += 1;
    await this.initImpl();
  }
  getSupportedFormats(): AudioFormat[] {
    return [this.format];
  }
  getOutputFormat(): AudioFormat {
    return this.format;
  }
  async start(): Promise<void> {
    this.startCalls += 1;
    if (this.startImpl instanceof Error) throw this.startImpl;
    await this.startImpl();
  }
  async sendText(text: string): Promise<void> {
    this.texts.push(text);
    if (this.sendTextImpl instanceof Error) throw this.sendTextImpl;
    await this.sendTextImpl(text);
  }
  async end(): Promise<void> {
    this.endCalls += 1;
    if (this.endImpl instanceof Error) throw this.endImpl;
    await this.endImpl();
    if (this.endedCb) await this.endedCb();
  }
  async cancel(): Promise<void> {
    this.cancelCalls += 1;
  }
  setOnGenerationStarted(cb: SimpleCallback): void {
    this.startedCb = cb;
  }
  setOnGenerationEnded(cb: SimpleCallback): void {
    this.endedCb = cb;
  }
  setOnError(cb: ErrorCallback): void {
    this.errorCb = cb;
  }
  setOnSpeechGenerating(cb: SpeechGenerationCallback<GeneratedAudioChunk>): void {
    this.speechCb = cb;
  }
  async cleanup(): Promise<void> {
    this.cleanupCalls += 1;
  }
  setFallbackOf(id: string): void {
    this.fallbackOf = id;
  }
  async emitChunk(): Promise<void> {
    if (!this.speechCb) return;
    await this.speechCb({ chunkId: 'c1', ordinal: 0, audio: Buffer.from('x'), audioFormat: this.format, isFinal: false });
  }
  async emitError(error: Error): Promise<void> {
    if (this.errorCb) await this.errorCb(error);
  }
}

function ttsWrapper(primary: FakeTts, steps: FallbackStep[], deps?: Partial<Record<string, unknown>>): { wrapper: FailoverTtsProvider; metrics: FakeMetrics; events: FakeFallbackEvents; breaker: FakeBreakerRegistry } {
  const metrics = new FakeMetrics();
  const events = new FakeFallbackEvents();
  const breaker = (deps?.breaker as FakeBreakerRegistry) ?? new FakeBreakerRegistry({});
  const wrapper = new FailoverTtsProvider(
    'primary',
    primary as unknown as ITtsProvider,
    steps,
    { provider: 'elevenlabs', voiceId: 'v' } as TtsSettings,
    {
      factory: deps?.factory ?? ({} as TtsProviderFactory),
      breakerRegistry: breaker as unknown as CircuitBreakerRegistry,
      fallbackEvents: events as unknown as FallbackEventService,
      metrics: metrics as unknown as MetricsRegistry,
      precreatedInstances: deps?.precreated as Map<string, ITtsProvider> | undefined,
    },
  );
  return { wrapper, metrics, events, breaker };
}

// --- ASR fakes ---

class FakeAsr {
  initImpl: (() => Promise<void>) | Error = async () => {};
  startImpl: (() => Promise<void>) | Error = async () => {};
  sendAudioImpl: (() => Promise<void>) | Error = async () => {};
  stopImpl: (() => Promise<void>) | Error = async () => {};
  initCalls = 0;
  startCalls = 0;
  stopCalls = 0;
  cleanupCalls = 0;
  audioSent: Buffer[] = [];
  fallbackOf: string | null = null;
  chunks: TextChunk[] = [];
  recognizingCb?: TextRecognitionCallback;
  recognizedCb?: TextRecognitionCallback;
  stoppedCb?: () => void;
  startedCb?: () => void;
  errorCb?: ErrorCallback;

  getSupportedInputFormats(): AudioFormat[] {
    return ['pcm_16000'];
  }
  async init(): Promise<void> {
    this.initCalls += 1;
    if (this.initImpl instanceof Error) throw this.initImpl;
    await this.initImpl();
  }
  async start(): Promise<void> {
    this.startCalls += 1;
    if (this.startImpl instanceof Error) throw this.startImpl;
    await this.startImpl();
    if (this.startedCb) this.startedCb();
  }
  markInputEnded(): void {}
  async stop(): Promise<void> {
    this.stopCalls += 1;
    if (this.stopImpl instanceof Error) throw this.stopImpl;
    await this.stopImpl();
    if (this.stoppedCb) this.stoppedCb();
  }
  async sendAudio(audio: Buffer): Promise<void> {
    this.audioSent.push(audio);
    if (this.sendAudioImpl instanceof Error) throw this.sendAudioImpl;
    await this.sendAudioImpl();
  }
  setOnRecognizing(cb: TextRecognitionCallback): void {
    this.recognizingCb = cb;
  }
  setOnRecognized(cb: TextRecognitionCallback): void {
    this.recognizedCb = cb;
  }
  setOnRecognitionStopped(cb: () => void): void {
    this.stoppedCb = cb;
  }
  setOnRecognitionStarted(cb: () => void): void {
    this.startedCb = cb;
  }
  setOnError(cb: ErrorCallback): void {
    this.errorCb = cb;
  }
  getAllTextChunks(): TextChunk[] {
    return this.chunks;
  }
  resetForNewTurn(): void {}
  async cleanup(): Promise<void> {
    this.cleanupCalls += 1;
  }
  setFallbackOf(id: string): void {
    this.fallbackOf = id;
  }
  async emitRecognizing(text: string): Promise<void> {
    if (this.recognizingCb) this.recognizingCb('c1', text);
  }
  async emitRecognized(text: string): Promise<void> {
    if (this.recognizedCb) this.recognizedCb('c1', text);
    this.chunks.push({ chunkId: 'c1', text, timestamp: new Date() });
  }
  async emitError(error: Error): Promise<void> {
    if (this.errorCb) await this.errorCb(error);
  }
}

function asrWrapper(primary: FakeAsr, steps: FallbackStep[], deps?: Partial<Record<string, unknown>>): { wrapper: FailoverAsrProvider; metrics: FakeMetrics; events: FakeFallbackEvents } {
  const metrics = new FakeMetrics();
  const events = new FakeFallbackEvents();
  const wrapper = new FailoverAsrProvider(
    'primary',
    primary as unknown as IAsrProvider,
    steps,
    {},
    {
      factory: deps?.factory ?? ({} as AsrProviderFactory),
      breakerRegistry: (deps?.breaker as FakeBreakerRegistry) ?? (new FakeBreakerRegistry({}) as unknown as CircuitBreakerRegistry),
      fallbackEvents: events as unknown as FallbackEventService,
      metrics: metrics as unknown as MetricsRegistry,
    },
  );
  return { wrapper, metrics, events };
}

// --- storage fakes ---

class FakeStorage {
  uploadImpl: ((key: string) => Promise<string>) | Error = async () => 'url';
  downloadImpl: ((key: string) => Promise<Buffer>) | Error = async () => Buffer.from('data');
  uploads: string[] = [];
  downloads: string[] = [];
  deletes: string[] = [];
  cleanupCalls = 0;
  fallbackOf: string | null = null;
  errorCb?: ErrorCallback;
  created = true;

  async init(): Promise<void> {}
  async upload(key: string): Promise<string> {
    this.uploads.push(key);
    if (this.uploadImpl instanceof Error) throw this.uploadImpl;
    return await this.uploadImpl(key);
  }
  async download(key: string): Promise<Buffer> {
    this.downloads.push(key);
    if (this.downloadImpl instanceof Error) throw this.downloadImpl;
    return await this.downloadImpl(key);
  }
  async delete(key: string): Promise<void> {
    this.deletes.push(key);
  }
  async getSignedUrl(key: string): Promise<string> {
    return `signed:${key}`;
  }
  async exists(): Promise<boolean> {
    return true;
  }
  async list(): Promise<StorageObject[]> {
    return [];
  }
  setOnError(cb: ErrorCallback): void {
    this.errorCb = cb;
  }
  setFallbackOf(id: string): void {
    this.fallbackOf = id;
  }
}

function storageWrapper(primary: FakeStorage, steps: FallbackStep[], deps?: Partial<Record<string, unknown>>): { wrapper: FailoverStorageProvider; metrics: FakeMetrics; events: FakeFallbackEvents } {
  const metrics = new FakeMetrics();
  const events = new FakeFallbackEvents();
  const wrapper = new FailoverStorageProvider(
    providerRow('primary'),
    steps,
    {},
    {
      factory: deps?.factory ?? ({} as StorageProviderFactory),
      breakerRegistry: (deps?.breaker as FakeBreakerRegistry) ?? (new FakeBreakerRegistry({}) as unknown as CircuitBreakerRegistry),
      fallbackEvents: events as unknown as FallbackEventService,
      metrics: metrics as unknown as MetricsRegistry,
    },
  );
  return { wrapper, metrics, events };
}

describe('P3-04 failover wrappers', () => {
  describe('FailoverTtsProvider', () => {
    it('serves directly from the primary when it is healthy (no events, no metrics)', async () => {
      const primary = new FakeTts();
      const { wrapper, metrics, events } = ttsWrapper(primary, [step('fb1')]);
      await wrapper.init();
      await wrapper.start();
      await wrapper.sendText('hello');
      await wrapper.end();

      expect(primary.startCalls).to.equal(1);
      expect(primary.texts).to.deep.equal(['hello']);
      expect(primary.endCalls).to.equal(1);
      expect(events.recorded).to.have.length(0);
      expect(metrics.increments).to.have.length(0);
    });

    it('fails over on start() rejection: next provider takes the session, transition row marked succeeded', async () => {
      const primary = new FakeTts();
      primary.startImpl = authError();
      const fb = new FakeTts();
      const precreated = new Map<string, ITtsProvider>([['fb1', fb as unknown as ITtsProvider]]);
      const chunks: GeneratedAudioChunk[] = [];
      const { wrapper, metrics, events } = ttsWrapper(primary, [step('fb1')], { precreated });

      wrapper.setOnSpeechGenerating(async (chunk) => {
        chunks.push(chunk);
      });
      await wrapper.init();
      await wrapper.start();
      await fb.emitChunk();

      expect(primary.startCalls).to.equal(1);
      expect(fb.startCalls).to.equal(1);
      expect(fb.fallbackOf).to.equal('primary');
      expect(chunks).to.have.length(1);
      expect(events.recorded).to.have.length(1);
      const row = events.recorded[0];
      expect(row.providerId).to.equal('primary');
      expect(row.fallbackProviderId).to.equal('fb1');
      expect(row.providerType).to.equal('tts');
      expect(row.operation).to.equal('tts.session');
      expect(row.reason).to.equal('auth');
      expect(events.succeeded).to.deep.equal([row.id]);
      expect(metrics.count('fallback_attempts_total', { provider_id: 'primary' })).to.equal(1);
    });

    it('retries once (500 ms) for a timeout start failure, then fails over', async () => {
      const primary = new FakeTts();
      let attempts = 0;
      primary.startImpl = async () => {
        attempts += 1;
        throw timeoutError();
      };
      const fb = new FakeTts();
      const precreated = new Map<string, ITtsProvider>([['fb1', fb as unknown as ITtsProvider]]);
      const { wrapper, metrics } = ttsWrapper(primary, [step('fb1')], { precreated });

      const startedAt = Date.now();
      await wrapper.start();
      const elapsed = Date.now() - startedAt;

      expect(attempts).to.equal(2);
      expect(fb.startCalls).to.equal(1);
      expect(elapsed).to.be.at.least(450);
      expect(metrics.count('fallback_attempts_total', { provider_id: 'primary' })).to.equal(1);
    });

    it('retry succeeding on the same provider writes no transition row and no attempt metric', async () => {
      const primary = new FakeTts();
      let attempts = 0;
      primary.startImpl = async () => {
        attempts += 1;
        if (attempts === 1) throw timeoutError();
      };
      const fb = new FakeTts();
      const precreated = new Map<string, ITtsProvider>([['fb1', fb as unknown as ITtsProvider]]);
      const { wrapper, metrics, events } = ttsWrapper(primary, [step('fb1')], { precreated });

      await wrapper.start();

      expect(attempts).to.equal(2);
      expect(fb.startCalls).to.equal(0);
      expect(events.recorded).to.have.length(0);
      expect(metrics.increments).to.have.length(0);
    });

    it('does not retry auth failures — moves straight to the fallback', async () => {
      const primary = new FakeTts();
      let attempts = 0;
      primary.startImpl = async () => {
        attempts += 1;
        throw authError();
      };
      const fb = new FakeTts();
      const precreated = new Map<string, ITtsProvider>([['fb1', fb as unknown as ITtsProvider]]);
      const { wrapper } = ttsWrapper(primary, [step('fb1')], { precreated });

      await wrapper.start();

      expect(attempts).to.equal(1);
      expect(fb.startCalls).to.equal(1);
    });

    it('fails over on a pre-audio sendText rejection and re-sends the text on the next provider', async () => {
      const primary = new FakeTts();
      primary.sendTextImpl = serverError();
      const fb = new FakeTts();
      const precreated = new Map<string, ITtsProvider>([['fb1', fb as unknown as ITtsProvider]]);
      const { wrapper, events } = ttsWrapper(primary, [step('fb1')], { precreated });

      await wrapper.start();
      await wrapper.sendText('hello');

      expect(primary.texts).to.deep.equal(['hello']);
      expect(fb.texts).to.deep.equal(['hello']);
      expect(fb.startCalls).to.equal(1);
      expect(events.recorded).to.have.length(1);
      expect(events.recorded[0].operation).to.equal('tts.session');
      expect(events.succeeded).to.have.length(1);
    });

    it('does NOT fail over after the first chunk was delivered (mid-turn)', async () => {
      const primary = new FakeTts();
      primary.sendTextImpl = serverError();
      const fb = new FakeTts();
      const precreated = new Map<string, ITtsProvider>([['fb1', fb as unknown as ITtsProvider]]);
      const { wrapper, events } = ttsWrapper(primary, [step('fb1')], { precreated });

      await wrapper.start();
      await primary.emitChunk(); // first chunk delivered
      await rejects(wrapper.sendText('hello'));
      expect(fb.startCalls).to.equal(0);
      expect(fb.texts).to.have.length(0);
      expect(events.recorded).to.have.length(0);
    });

    it('skips a circuit-open fallback (no call, no row, no attempt metric) and serves from the next', async () => {
      const primary = new FakeTts();
      primary.startImpl = authError();
      const fb1 = new FakeTts();
      const fb2 = new FakeTts();
      const precreated = new Map<string, ITtsProvider>([
        ['fb1', fb1 as unknown as ITtsProvider],
        ['fb2', fb2 as unknown as ITtsProvider],
      ]);
      const breaker = new FakeBreakerRegistry({ fb1: 'open' });
      const { wrapper, metrics, events } = ttsWrapper(primary, [step('fb1'), step('fb2')], { precreated, breaker });

      await wrapper.start();

      expect(fb1.startCalls).to.equal(0);
      expect(fb2.startCalls).to.equal(1);
      // A skipped step is not a failed attempt: only the primary failure
      // records a transition row (it names fb1 as the intended target; the
      // skip itself is visible via circuit_open_skips_total in P3-01).
      expect(events.recorded).to.have.length(1);
      expect(events.recorded[0].fallbackProviderId).to.equal('fb1');
      expect(events.succeeded).to.have.length(1);
      expect(metrics.count('fallback_attempts_total', { provider_id: 'fb1' })).to.equal(0);
      expect(metrics.count('fallback_attempts_total', { provider_id: 'primary' })).to.equal(1);
    });

    it('exhausts: throws the last original error, bumps the exhaustion metric, delivers onError once', async () => {
      const primary = new FakeTts();
      primary.startImpl = authError();
      const fb = new FakeTts();
      fb.startImpl = serverError();
      const precreated = new Map<string, ITtsProvider>([['fb1', fb as unknown as ITtsProvider]]);
      const errors: Error[] = [];
      const { wrapper, metrics, events } = ttsWrapper(primary, [step('fb1')], { precreated });
      wrapper.setOnError(async (error) => errors.push(error));

      let thrown: unknown = null;
      try {
        await wrapper.start();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).to.equal(fb.startImpl); // last original error
      expect(errors).to.have.length(1);
      expect(errors[0]).to.equal(fb.startImpl);
      expect(metrics.count('provider_chain_exhausted_total', { provider_id: 'primary' })).to.equal(1);
      expect(events.recorded).to.have.length(1);
      expect(events.succeeded).to.have.length(0);
    });

    it('all-breaker-skipped chain throws a descriptive circuit-open error', async () => {
      const primary = new FakeTts();
      const fb = new FakeTts();
      const precreated = new Map<string, ITtsProvider>([['fb1', fb as unknown as ITtsProvider]]);
      const breaker = new FakeBreakerRegistry({ primary: 'open', fb1: 'open' });
      const { wrapper } = ttsWrapper(primary, [step('fb1')], { precreated, breaker });

      const error = await rejects(wrapper.start());
      expect((error as Error).message).to.match(/circuit open/i);
      expect(primary.startCalls).to.equal(0);
      expect(fb.startCalls).to.equal(0);
    });

    it('resets the chain position on every start(): a recovered primary takes its turns back', async () => {
      const primary = new FakeTts();
      let primaryFailing = true;
      primary.startImpl = async () => {
        if (primaryFailing) throw authError();
      };
      const fb = new FakeTts();
      const precreated = new Map<string, ITtsProvider>([['fb1', fb as unknown as ITtsProvider]]);
      const { wrapper } = ttsWrapper(primary, [step('fb1')], { precreated });

      await wrapper.start(); // turn 1: primary fails -> fb
      expect(fb.startCalls).to.equal(1);
      await wrapper.end();

      primaryFailing = false;
      await wrapper.start(); // turn 2: primary recovers
      expect(primary.startCalls).to.equal(2);
      await wrapper.sendText('second turn');
      expect(primary.texts).to.deep.equal(['second turn']);
    });

    it('suppresses pre-audio callback-channel errors and forwards mid-turn ones', async () => {
      const primary = new FakeTts();
      const fb = new FakeTts();
      const precreated = new Map<string, ITtsProvider>([['fb1', fb as unknown as ITtsProvider]]);
      const seen: Error[] = [];
      const { wrapper } = ttsWrapper(primary, [step('fb1')], { precreated });
      wrapper.setOnError(async (error) => seen.push(error));

      await wrapper.start();
      await primary.emitError(new Error('pre-audio callback error'));
      expect(seen).to.have.length(0); // suppressed — the setup promises already resolved

      await primary.emitChunk();
      await primary.emitError(new Error('mid-turn callback error'));
      expect(seen).to.have.length(1);
      expect(seen[0].message).to.equal('mid-turn callback error');
    });

    it('delegates getOutputFormat/getSupportedFormats to the primary', () => {
      const primary = new FakeTts('pcm_16000');
      const { wrapper } = ttsWrapper(primary, [step('fb1')]);
      expect(wrapper.getOutputFormat()).to.equal('pcm_16000');
      expect(wrapper.getSupportedFormats()).to.deep.equal(['pcm_16000']);
    });

    it('end() with no active session is a no-op; cancel() forwards to the active', async () => {
      const primary = new FakeTts();
      const fb = new FakeTts();
      const precreated = new Map<string, ITtsProvider>([['fb1', fb as unknown as ITtsProvider]]);
      const { wrapper } = ttsWrapper(primary, [step('fb1')], { precreated });

      await wrapper.end(); // no session yet
      expect(primary.endCalls).to.equal(0);

      primary.startImpl = authError();
      await wrapper.start(); // fails over to fb
      await wrapper.cancel();
      expect(fb.cancelCalls).to.equal(1);
    });

    it('cleanup() forwards to the primary and every created fallback instance', async () => {
      const primary = new FakeTts();
      primary.startImpl = authError();
      const fb = new FakeTts();
      const precreated = new Map<string, ITtsProvider>([['fb1', fb as unknown as ITtsProvider]]);
      const { wrapper } = ttsWrapper(primary, [step('fb1')], { precreated });

      await wrapper.start();
      await wrapper.cleanup();
      expect(primary.cleanupCalls).to.equal(1);
      expect(fb.cleanupCalls).to.equal(1);
    });

    it('init() initialises the primary; fallback instances are init()-ed exactly once across turns', async () => {
      const primary = new FakeTts();
      let primaryFailing = true;
      primary.startImpl = async () => {
        if (primaryFailing) throw authError();
      };
      const fb = new FakeTts();
      const precreated = new Map<string, ITtsProvider>([['fb1', fb as unknown as ITtsProvider]]);
      const { wrapper } = ttsWrapper(primary, [step('fb1')], { precreated });

      await wrapper.init();
      expect(primary.initCalls).to.equal(1);

      await wrapper.start(); // primary fails -> fb (init + start)
      await wrapper.end();
      primaryFailing = false;
      await wrapper.start(); // primary serves again — fb NOT re-initialised
      await wrapper.end();
      expect(fb.initCalls).to.equal(1);
    });
  });

  describe('FailoverAsrProvider', () => {
    it('serves directly from the primary when healthy (init + start, no events)', async () => {
      const primary = new FakeAsr();
      const { wrapper, metrics, events } = asrWrapper(primary, [step('fb1')]);
      await wrapper.init();
      await wrapper.start();
      await wrapper.sendAudio(Buffer.from('pcm'));
      await wrapper.stop();

      expect(primary.initCalls).to.equal(1);
      expect(primary.startCalls).to.equal(1);
      expect(primary.audioSent).to.have.length(1);
      expect(primary.stopCalls).to.equal(1);
      expect(events.recorded).to.have.length(0);
      expect(metrics.increments).to.have.length(0);
    });

    it('fails over on init() rejection: next provider is initialised and active', async () => {
      const primary = new FakeAsr();
      primary.initImpl = authError();
      const fb = new FakeAsr();
      const factory = { createProvider: async (row: ProviderRow) => (row.id === 'fb1' ? fb : primary) as unknown as IAsrProvider };
      const { wrapper, metrics, events } = asrWrapper(primary, [step('fb1')], { factory: factory as unknown as AsrProviderFactory });

      await wrapper.init();

      expect(primary.initCalls).to.equal(1);
      expect(fb.initCalls).to.equal(1);
      expect(fb.fallbackOf).to.equal('primary');
      await wrapper.start();
      expect(fb.startCalls).to.equal(1);
      // init() records primary→fb1; start() walks the chain from the primary
      // again and re-attempts the primary's failed init (per-turn chain walk),
      // recording a second transition before fb takes the session.
      expect(events.recorded).to.have.length(2);
      expect(events.recorded[0]).to.include({ providerId: 'primary', fallbackProviderId: 'fb1', providerType: 'asr', operation: 'asr.session', reason: 'auth' });
      expect(events.succeeded).to.have.length(2);
      expect(metrics.count('fallback_attempts_total', { provider_id: 'primary' })).to.equal(2);
    });

    it('fails over on start() rejection: the fallback is init()-ed lazily and takes the session (timeout retries once first)', async () => {
      const primary = new FakeAsr();
      primary.startImpl = timeoutError();
      const fb = new FakeAsr();
      const factory = { createProvider: async (row: ProviderRow) => (row.id === 'fb1' ? fb : primary) as unknown as IAsrProvider };
      const { wrapper, events } = asrWrapper(primary, [step('fb1')], { factory: factory as unknown as AsrProviderFactory });

      await wrapper.init(); // primary inits fine
      await wrapper.start(); // primary start fails (x2: retry) -> fb

      expect(primary.startCalls).to.equal(2);
      expect(fb.initCalls).to.equal(1);
      expect(fb.startCalls).to.equal(1);
      expect(events.recorded[0].reason).to.equal('timeout');
      expect(events.succeeded).to.have.length(1);
    });

    it('resets the chain position per start(): a recovered primary takes its turns back', async () => {
      const primary = new FakeAsr();
      let primaryFailing = true;
      primary.startImpl = async () => {
        if (primaryFailing) throw authError();
      };
      const fb = new FakeAsr();
      const factory = { createProvider: async (row: ProviderRow) => (row.id === 'fb1' ? fb : primary) as unknown as IAsrProvider };
      const { wrapper } = asrWrapper(primary, [step('fb1')], { factory: factory as unknown as AsrProviderFactory });

      await wrapper.init();
      await wrapper.start(); // turn 1: primary fails -> fb
      expect(fb.startCalls).to.equal(1);
      await wrapper.stop();

      primaryFailing = false;
      await wrapper.start(); // turn 2: primary recovered
      expect(primary.startCalls).to.equal(2);
      expect(fb.startCalls).to.equal(1);
    });

    it('sendAudio failure never fails over (mid-session)', async () => {
      const primary = new FakeAsr();
      const fb = new FakeAsr();
      const factory = { createProvider: async (row: ProviderRow) => (row.id === 'fb1' ? fb : primary) as unknown as IAsrProvider };
      const { wrapper, events } = asrWrapper(primary, [step('fb1')], { factory: factory as unknown as AsrProviderFactory });
      await wrapper.init();
      await wrapper.start();

      primary.sendAudioImpl = serverError();
      await rejects(wrapper.sendAudio(Buffer.from('x')));
      expect(fb.startCalls).to.equal(0);
      expect(events.recorded).to.have.length(0);
    });

    it('forwards recognition callbacks without suppression', async () => {
      const primary = new FakeAsr();
      const { wrapper } = asrWrapper(primary, [step('fb1')]);
      const partials: string[] = [];
      const finals: string[] = [];
      const errors: Error[] = [];
      let stopped = 0;
      let started = 0;
      wrapper.setOnRecognizing((_id, text) => partials.push(text));
      wrapper.setOnRecognized((_id, text) => finals.push(text));
      wrapper.setOnRecognitionStopped(() => (stopped += 1));
      wrapper.setOnRecognitionStarted(() => (started += 1));
      wrapper.setOnError(async (error) => errors.push(error));

      await wrapper.init();
      expect(started).to.equal(0); // not started yet
      await wrapper.start();
      expect(started).to.equal(1);
      await primary.emitRecognizing('partial');
      await primary.emitRecognized('final');
      await primary.emitError(new Error('mid-session recognition error'));
      await wrapper.stop();

      expect(partials).to.deep.equal(['partial']);
      expect(finals).to.deep.equal(['final']);
      expect(errors).to.have.length(1);
      expect(stopped).to.equal(1);
    });

    it('exhausts on init: throws the last original error and delivers onError once', async () => {
      const primary = new FakeAsr();
      primary.initImpl = authError();
      const fb = new FakeAsr();
      fb.initImpl = serverError();
      const factory = { createProvider: async (row: ProviderRow) => (row.id === 'fb1' ? fb : primary) as unknown as IAsrProvider };
      const errors: Error[] = [];
      const { wrapper, metrics, events } = asrWrapper(primary, [step('fb1')], { factory: factory as unknown as AsrProviderFactory });
      wrapper.setOnError(async (error) => errors.push(error));

      let thrown: unknown = null;
      try {
        await wrapper.init();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).to.equal(fb.initImpl);
      expect(errors).to.have.length(1);
      expect(metrics.count('provider_chain_exhausted_total', { provider_id: 'primary' })).to.equal(1);
      expect(events.recorded).to.have.length(1);
      expect(events.succeeded).to.have.length(0);
    });

    it('skips a circuit-open fallback during the start() walk', async () => {
      const primary = new FakeAsr();
      primary.startImpl = authError();
      const fb1 = new FakeAsr();
      const fb2 = new FakeAsr();
      const factory = { createProvider: async (row: ProviderRow) => (row.id === 'fb1' ? fb1 : fb2) as unknown as IAsrProvider };
      const breaker = new FakeBreakerRegistry({ fb1: 'open' });
      const { wrapper, metrics } = asrWrapper(primary, [step('fb1'), step('fb2')], { factory: factory as unknown as AsrProviderFactory, breaker });

      await wrapper.init();
      await wrapper.start();

      expect(fb1.startCalls).to.equal(0);
      expect(fb2.startCalls).to.equal(1);
      expect(metrics.count('fallback_attempts_total', { provider_id: 'fb1' })).to.equal(0);
    });

    it('cleanup() forwards to the primary and created fallbacks; pass-throughs hit the active provider', async () => {
      const primary = new FakeAsr();
      primary.startImpl = authError();
      const fb = new FakeAsr();
      const factory = { createProvider: async (row: ProviderRow) => (row.id === 'fb1' ? fb : primary) as unknown as IAsrProvider };
      const { wrapper } = asrWrapper(primary, [step('fb1')], { factory: factory as unknown as AsrProviderFactory });

      await wrapper.init();
      await wrapper.start(); // active is fb (primary start failed)
      fb.chunks.push({ chunkId: 'c1', text: 'hi', timestamp: new Date() });
      wrapper.markInputEnded(123);
      expect(wrapper.getAllTextChunks()).to.have.length(1);
      expect(wrapper.getSupportedInputFormats()).to.deep.equal(['pcm_16000']);
      wrapper.resetForNewTurn();
      await wrapper.cleanup();
      expect(primary.cleanupCalls).to.equal(1);
      expect(fb.cleanupCalls).to.equal(1);
    });
  });

  describe('FailoverStorageProvider', () => {
    it('serves directly from the primary when healthy (no events, no metrics)', async () => {
      const primary = new FakeStorage();
      const fb = new FakeStorage();
      const factory = { createProvider: async (row: ProviderRow) => (row.id === 'primary' ? primary : fb) as unknown as IStorageProvider };
      const { wrapper, metrics, events } = storageWrapper(primary, [step('fb1')], { factory: factory as unknown as StorageProviderFactory });

      const url = await wrapper.upload('k1', Buffer.from('x'));

      expect(url).to.equal('url');
      expect(primary.uploads).to.deep.equal(['k1']);
      expect(fb.uploads).to.have.length(0);
      expect(events.recorded).to.have.length(0);
      expect(metrics.increments).to.have.length(0);
    });

    it('fails over on upload failure: next provider serves, transition row marked succeeded', async () => {
      const primary = new FakeStorage();
      primary.uploadImpl = serverError();
      const fb = new FakeStorage();
      const factory = { createProvider: async (row: ProviderRow) => (row.id === 'primary' ? primary : fb) as unknown as IStorageProvider };
      const { wrapper, metrics, events } = storageWrapper(primary, [step('fb1')], { factory: factory as unknown as StorageProviderFactory });

      const url = await wrapper.upload('k1', Buffer.from('x'));

      expect(url).to.equal('url');
      expect(primary.uploads).to.deep.equal(['k1', 'k1']); // server_error retries once before failing over
      expect(fb.uploads).to.deep.equal(['k1']);
      expect(fb.fallbackOf).to.equal('primary');
      expect(events.recorded).to.have.length(1);
      expect(events.recorded[0]).to.include({ providerId: 'primary', fallbackProviderId: 'fb1', providerType: 'storage', operation: 'storage.upload', reason: 'server_error' });
      expect(events.succeeded).to.have.length(1);
      expect(metrics.count('fallback_attempts_total', { provider_id: 'primary' })).to.equal(1);
    });

    it('fails over when the primary INSTANCE CREATION fails (factory init rejection)', async () => {
      const fb = new FakeStorage();
      const factory = {
        createProvider: async (row: ProviderRow) => {
          if (row.id === 'primary') throw timeoutError();
          return fb as unknown as IStorageProvider;
        },
      };
      const { wrapper, events } = storageWrapper(new FakeStorage(), [step('fb1')], { factory: factory as unknown as StorageProviderFactory });

      const url = await wrapper.upload('k1', Buffer.from('x'));

      expect(url).to.equal('url');
      expect(fb.uploads).to.deep.equal(['k1']);
      expect(events.recorded).to.have.length(1);
      expect(events.recorded[0].reason).to.equal('timeout');
      expect(events.succeeded).to.have.length(1);
    });

    it('fails over on download failure too (operation = storage.download)', async () => {
      const primary = new FakeStorage();
      primary.downloadImpl = serverError();
      const fb = new FakeStorage();
      const factory = { createProvider: async (row: ProviderRow) => (row.id === 'primary' ? primary : fb) as unknown as IStorageProvider };
      const { wrapper, events } = storageWrapper(primary, [step('fb1')], { factory: factory as unknown as StorageProviderFactory });

      const data = await wrapper.download('k1');

      expect(data.toString()).to.equal('data');
      expect(fb.downloads).to.deep.equal(['k1']);
      expect(events.recorded[0].operation).to.equal('storage.download');
      expect(events.succeeded).to.have.length(1);
    });

    it('retries once for a server_error upload before failing over', async () => {
      const primary = new FakeStorage();
      let attempts = 0;
      primary.uploadImpl = async () => {
        attempts += 1;
        throw serverError();
      };
      const fb = new FakeStorage();
      const factory = { createProvider: async (row: ProviderRow) => (row.id === 'primary' ? primary : fb) as unknown as IStorageProvider };
      const { wrapper } = storageWrapper(primary, [step('fb1')], { factory: factory as unknown as StorageProviderFactory });

      await wrapper.upload('k1', Buffer.from('x'));

      expect(attempts).to.equal(2);
      expect(fb.uploads).to.deep.equal(['k1']);
    });

    it('skips a circuit-open fallback (no call, no row, no attempt metric)', async () => {
      const primary = new FakeStorage();
      primary.uploadImpl = serverError();
      const fb1 = new FakeStorage();
      const fb2 = new FakeStorage();
      const factory = {
        createProvider: async (row: ProviderRow) => {
          if (row.id === 'primary') return primary;
          if (row.id === 'fb1') return fb1;
          return fb2;
        },
      };
      const breaker = new FakeBreakerRegistry({ fb1: 'open' });
      const { wrapper, metrics, events } = storageWrapper(primary, [step('fb1'), step('fb2')], { factory: factory as unknown as StorageProviderFactory, breaker });

      await wrapper.upload('k1', Buffer.from('x'));

      expect(fb1.uploads).to.have.length(0);
      expect(fb2.uploads).to.deep.equal(['k1']);
      // A skipped step is not a failed attempt: only the primary failure
      // records a transition row (P3-03 semantics).
      expect(events.recorded).to.have.length(1);
      expect(events.recorded[0].fallbackProviderId).to.equal('fb1');
      expect(events.succeeded).to.have.length(1);
      expect(metrics.count('fallback_attempts_total', { provider_id: 'fb1' })).to.equal(0);
    });

    it('exhausts: throws the last original error, bumps the metric, delivers onError once', async () => {
      const primary = new FakeStorage();
      primary.uploadImpl = authError();
      const fb = new FakeStorage();
      fb.uploadImpl = serverError();
      const factory = { createProvider: async (row: ProviderRow) => (row.id === 'primary' ? primary : fb) as unknown as IStorageProvider };
      const errors: Error[] = [];
      const { wrapper, metrics, events } = storageWrapper(primary, [step('fb1')], { factory: factory as unknown as StorageProviderFactory });
      wrapper.setOnError(async (error) => errors.push(error));

      let thrown: unknown = null;
      try {
        await wrapper.upload('k1', Buffer.from('x'));
      } catch (error) {
        thrown = error;
      }

      expect(thrown).to.equal(fb.uploadImpl);
      expect(errors).to.have.length(1);
      expect(metrics.count('provider_chain_exhausted_total', { provider_id: 'primary' })).to.equal(1);
      expect(events.recorded).to.have.length(1);
      expect(events.succeeded).to.have.length(0);
    });

    it('delete/exists/list/getSignedUrl forward to the primary only', async () => {
      const primary = new FakeStorage();
      const fb = new FakeStorage();
      const factory = { createProvider: async (row: ProviderRow) => (row.id === 'primary' ? primary : fb) as unknown as IStorageProvider };
      const { wrapper } = storageWrapper(primary, [step('fb1')], { factory: factory as unknown as StorageProviderFactory });

      await wrapper.init();
      await wrapper.delete('k1');
      await wrapper.exists('k1');
      await wrapper.list('p');
      const url = await wrapper.getSignedUrl('k1', 60);

      expect(primary.deletes).to.deep.equal(['k1']);
      expect(fb.deletes).to.have.length(0);
      expect(url).to.equal('signed:k1');
    });

    it('suppresses per-attempt provider error callbacks; exhaustion delivers once', async () => {
      const primary = new FakeStorage();
      const fb = new FakeStorage();
      const factory = { createProvider: async (row: ProviderRow) => (row.id === 'primary' ? primary : fb) as unknown as IStorageProvider };
      const seen: Error[] = [];
      const { wrapper } = storageWrapper(primary, [step('fb1')], { factory: factory as unknown as StorageProviderFactory });
      wrapper.setOnError(async (error) => seen.push(error));

      primary.uploadImpl = authError();
      fb.uploadImpl = authError();
      // Simulate a per-attempt callback delivery from the primary instance.
      await (async () => {
        try {
          await wrapper.upload('k1', Buffer.from('x'));
        } catch {}
      })();

      expect(seen).to.have.length(1); // only the exhaustion delivery
    });

    it('caches created instances across operations', async () => {
      const primary = new FakeStorage();
      const fb = new FakeStorage();
      let creations = 0;
      const factory = {
        createProvider: async (row: ProviderRow) => {
          creations += 1;
          return (row.id === 'primary' ? primary : fb) as unknown as IStorageProvider;
        },
      };
      const { wrapper } = storageWrapper(primary, [step('fb1')], { factory: factory as unknown as StorageProviderFactory });

      await wrapper.init(); // creates primary
      primary.uploadImpl = serverError();
      await wrapper.upload('k1', Buffer.from('x')); // creates fb (1 retry on primary first)
      primary.uploadImpl = async () => 'url';
      await wrapper.upload('k2', Buffer.from('y')); // primary healthy — fb NOT recreated

      expect(creations).to.equal(2);
    });
  });

});

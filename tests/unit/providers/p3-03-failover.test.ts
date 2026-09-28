import 'reflect-metadata';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { FailoverLlmProvider } from '../../../src/services/providers/llm/FailoverLlmProvider';
import type { ILlmProvider, LlmChunk, LlmChunkCallback, LlmCompleteCallback, LlmGenerationOptions, LlmGenerationResult, LlmMessage } from '../../../src/services/providers/llm/ILlmProvider';
import type { ErrorCallback, SimpleCallback } from '../../../src/types/callbacks';
import type { FallbackStep } from '../../../src/services/providers/FallbackResolver';
import { CircuitOpenError } from '../../../src/errors';

// --- fakes ---

function makeError(status?: number, code?: string, message = 'provider error'): Error {
  const error = new Error(message);
  if (status !== undefined) (error as any).status = status;
  if (code !== undefined) (error as any).code = code;
  return error;
}

const AUTH_ERROR = () => makeError(401, undefined, 'Invalid API key');
const SERVER_ERROR = () => makeError(500, undefined, 'Internal server error');
const TIMEOUT_ERROR = () => makeError(undefined, 'UND_ERR_CONNECT_TIMEOUT', 'connect timeout');

type Behavior = 'ok' | 'fail-setup' | 'fail-midstream';

class FakeLlm implements ILlmProvider {
  readonly id: string;
  generateCalls = 0;
  generateStreamCalls = 0;
  cleanups = 0;
  modelsCalls = 0;
  moderateCalls = 0;
  behavior: Behavior = 'ok';
  setupError: Error = AUTH_ERROR();
  chunkTexts = ['Hello', ' world'];
  receivedErrors: Error[] = [];
  completedResults: LlmGenerationResult[] = [];

  private chunkCb?: LlmChunkCallback;
  private startedCb?: SimpleCallback;
  private completedCb?: LlmCompleteCallback;
  private errorCb?: ErrorCallback;

  constructor(id: string) {
    this.id = id;
  }

  async init(): Promise<void> {}

  async generate(_messages: LlmMessage[], _options?: LlmGenerationOptions): Promise<LlmGenerationResult> {
    this.generateCalls += 1;
    if (this.behavior === 'fail-setup') {
      if (this.errorCb) await this.errorCb(this.setupError);
      throw this.setupError;
    }
    const result = this.result('text from ' + this.id);
    this.completedResults.push(result);
    if (this.completedCb) await this.completedCb(result);
    return result;
  }

  async generateStream(_messages: LlmMessage[], _options?: LlmGenerationOptions): Promise<void> {
    this.generateStreamCalls += 1;
    if (this.behavior === 'fail-setup') {
      if (this.errorCb) await this.errorCb(this.setupError);
      throw this.setupError;
    }
    if (this.behavior === 'fail-midstream') {
      if (this.chunkCb) await this.chunkCb({ id: 'c1', content: this.chunkTexts[0] });
      if (this.errorCb) await this.errorCb(this.setupError);
      throw this.setupError;
    }
    for (const text of this.chunkTexts) {
      if (this.chunkCb) await this.chunkCb({ id: 'c1', content: text });
    }
    const result = this.result(this.chunkTexts.join(''));
    this.completedResults.push(result);
    if (this.completedCb) await this.completedCb(result);
  }

  private result(text: string): LlmGenerationResult {
    return {
      id: 'gen_' + this.id,
      content: [{ contentType: 'text', text }],
      role: 'assistant',
      finishReason: 'stop',
    };
  }

  setOnChunk(cb: LlmChunkCallback): void { this.chunkCb = cb; }
  setOnGenerationStarted(cb: SimpleCallback): void { this.startedCb = cb; }
  setOnGenerationCompleted(cb: LlmCompleteCallback): void { this.completedCb = cb; }
  setOnError(cb: ErrorCallback): void { this.errorCb = cb; }
  isInitialized(): boolean { return true; }
  async cleanup(): Promise<void> { this.cleanups += 1; }
  async enumerateModels(): Promise<never[]> { this.modelsCalls += 1; return []; }
  async moderateUserInput(_input: string): Promise<{ flagged: boolean; categories: string[] }> { this.moderateCalls += 1; return { flagged: false, categories: [] }; }
}

interface MetricsInc { name: string; labels: Record<string, unknown>; }
interface RecordedEvent {
  providerId: string;
  fallbackProviderId: string;
  providerType: string;
  operation: string;
  reason: string;
  projectId: string | null;
  conversationId: string | null;
  success: boolean;
}

function makeDeps(fakes: Record<string, FakeLlm>) {
  const incs: MetricsInc[] = [];
  const recorded: RecordedEvent[] = [];
  const marked: string[] = [];
  const created: Array<{ id: string; settings: unknown }> = [];
  const skipCalls: string[] = [];
  const states: Record<string, 'closed' | 'open' | 'half-open'> = {};
  const deps = {
    incs,
    recorded,
    marked,
    created,
    skipCalls,
    setBreakerState(providerId: string, state: 'closed' | 'open' | 'half-open') { states[providerId] = state; },
    factory: {
      async createProvider(provider: { id: string }, settings: unknown) {
        created.push({ id: provider.id, settings });
        return fakes[provider.id];
      },
    },
    breakerRegistry: {
      getState(providerId: string) { return states[providerId] ?? null; },
      getBreaker(providerId: string) {
        return {
          beforeCall() {
            const state = states[providerId];
            if (state === 'open' || state === 'half-open') {
              skipCalls.push(providerId);
              throw new CircuitOpenError(providerId);
            }
          },
        };
      },
    },
    fallbackEvents: {
      async record(input: RecordedEvent) {
        recorded.push(input);
        return { id: `fbev_${recorded.length}` };
      },
      async markSucceeded(rowId: string) { marked.push(rowId); },
    },
    metrics: {
      inc(name: string, labels?: Record<string, unknown>) { incs.push({ name, labels: labels ?? {} }); },
    },
  };
  return deps;
}

function step(providerId: string, settings?: Record<string, unknown>): FallbackStep {
  return { provider: { id: providerId } as never, settings } as FallbackStep;
}

const MESSAGES: LlmMessage[] = [{ role: 'user', content: 'hi' }];
const BASE_SETTINGS = { model: 'base-model', temperature: 0.7 } as never;

function makeWrapper(primaryId: string, primary: FakeLlm, steps: FallbackStep[], deps: ReturnType<typeof makeDeps>) {
  const wrapper = new FailoverLlmProvider(primaryId, primary, steps, BASE_SETTINGS, deps as never);
  const received: string[] = [];
  const errors: Error[] = [];
  wrapper.setOnChunk(async (chunk: LlmChunk) => { received.push(chunk.content); });
  wrapper.setOnError(async (error: Error) => { errors.push(error); });
  return { wrapper, received, errors };
}

describe('FailoverLlmProvider (P3-03, unit)', () => {
  let a: FakeLlm;
  let b: FakeLlm;
  let c: FakeLlm;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    a = new FakeLlm('prov_a');
    b = new FakeLlm('prov_b');
    c = new FakeLlm('prov_c');
    deps = makeDeps({ prov_a: a, prov_b: b, prov_c: c });
  });

  describe('streaming', () => {
    it('primary succeeds — no fallback attempts, no factory calls, no events', async () => {
      const { wrapper, received, errors } = makeWrapper('prov_a', a, [step('prov_b')], deps);
      await wrapper.generateStream(MESSAGES);
      expect(a.generateStreamCalls).to.equal(1);
      expect(b.generateStreamCalls).to.equal(0);
      expect(received).to.deep.equal(['Hello', ' world']);
      expect(errors).to.be.empty;
      expect(deps.created).to.be.empty;
      expect(deps.recorded).to.be.empty;
      expect(deps.marked).to.be.empty;
    });

    it('pre-token failure fails over: one event row, marked succeeded, chunks from the fallback', async () => {
      a.behavior = 'fail-setup';
      a.setupError = AUTH_ERROR();
      const { wrapper, received, errors } = makeWrapper('prov_a', a, [step('prov_b')], deps);
      await wrapper.generateStream(MESSAGES);
      expect(a.generateStreamCalls).to.equal(1);
      expect(b.generateStreamCalls).to.equal(1);
      expect(received).to.deep.equal(['Hello', ' world']);
      expect(errors).to.be.empty;
      expect(deps.recorded).to.have.length(1);
      expect(deps.recorded[0].providerId).to.equal('prov_a');
      expect(deps.recorded[0].fallbackProviderId).to.equal('prov_b');
      expect(deps.recorded[0].providerType).to.equal('llm');
      expect(deps.recorded[0].reason).to.equal('auth');
      expect(deps.recorded[0].success).to.equal(false);
      expect(deps.marked).to.deep.equal(['fbev_1']);
      const attempts = deps.incs.filter((i) => i.name === 'fallback_attempts_total');
      expect(attempts).to.deep.equal([{ name: 'fallback_attempts_total', labels: { provider_id: 'prov_a' } }]);
      expect(deps.incs.some((i) => i.name === 'provider_chain_exhausted_total')).to.equal(false);
    });

    it('mid-stream failure never fails over: rethrows, no event row, fallback untouched', async () => {
      a.behavior = 'fail-midstream';
      a.setupError = SERVER_ERROR();
      const { wrapper, received, errors } = makeWrapper('prov_a', a, [step('prov_b')], deps);
      try {
        await wrapper.generateStream(MESSAGES);
        expect.fail('should have thrown');
      } catch (error) {
        expect(error).to.equal(a.setupError);
      }
      expect(b.generateStreamCalls).to.equal(0);
      expect(received).to.deep.equal(['Hello']);
      expect(errors).to.have.length(1); // delivered once, mid-stream
      expect(deps.recorded).to.be.empty;
      expect(deps.marked).to.be.empty;
    });

    it('breaker-open step is skipped: no call, no event row, no attempts metric', async () => {
      deps.setBreakerState('prov_a', 'open');
      const { wrapper, received, errors } = makeWrapper('prov_a', a, [step('prov_b')], deps);
      await wrapper.generateStream(MESSAGES);
      expect(a.generateStreamCalls).to.equal(0);
      expect(b.generateStreamCalls).to.equal(1);
      expect(deps.skipCalls).to.deep.equal(['prov_a']);
      expect(received).to.deep.equal(['Hello', ' world']);
      expect(errors).to.be.empty;
      expect(deps.recorded).to.be.empty; // skip is not a failed attempt
      expect(deps.incs.some((i) => i.name === 'fallback_attempts_total')).to.equal(false);
      expect(deps.incs.some((i) => i.name === 'provider_chain_exhausted_total')).to.equal(false);
    });

    it('full chain exhaustion: throws the last original error, one event row, single onError, exhaustion metric', async () => {
      a.behavior = 'fail-setup';
      a.setupError = AUTH_ERROR();
      b.behavior = 'fail-setup';
      const bError = makeError(401, undefined, 'B also failed');
      b.setupError = bError;
      const { wrapper, errors } = makeWrapper('prov_a', a, [step('prov_b')], deps);
      let thrown: unknown = null;
      try {
        await wrapper.generateStream(MESSAGES);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).to.equal(bError);
      expect(errors).to.have.length(1);
      expect(errors[0]).to.equal(bError);
      expect(deps.recorded).to.have.length(1);
      expect(deps.recorded[0]).to.include({ providerId: 'prov_a', fallbackProviderId: 'prov_b', reason: 'auth', success: false });
      expect(deps.marked).to.be.empty;
      const attempts = deps.incs.filter((i) => i.name === 'fallback_attempts_total').map((i) => i.labels.provider_id);
      expect(attempts).to.deep.equal(['prov_a', 'prov_b']);
      expect(deps.incs.some((i) => i.name === 'provider_chain_exhausted_total' && i.labels.provider_id === 'prov_a')).to.equal(true);
    });

    it('every step breaker-open: descriptive error, exhaustion metric, zero calls', async () => {
      deps.setBreakerState('prov_a', 'open');
      deps.setBreakerState('prov_b', 'open');
      const { wrapper, errors } = makeWrapper('prov_a', a, [step('prov_b')], deps);
      try {
        await wrapper.generateStream(MESSAGES);
        expect.fail('should have thrown');
      } catch (error) {
        expect((error as Error).message).to.include('circuit open');
        expect((error as Error).message).to.include('prov_a');
      }
      expect(a.generateStreamCalls).to.equal(0);
      expect(b.generateStreamCalls).to.equal(0);
      expect(errors).to.have.length(1);
      expect(deps.incs.some((i) => i.name === 'provider_chain_exhausted_total' && i.labels.provider_id === 'prov_a')).to.equal(true);
    });

    it('three-provider chain: A fails, B fails, C serves — one event row (A→B only at transition time), marked when C serves', async () => {
      // Two transitions: A→B (recorded, later not the serving one) and B→C (recorded, then marked).
      a.behavior = 'fail-setup';
      b.behavior = 'fail-setup';
      const { wrapper, received, errors } = makeWrapper('prov_a', a, [step('prov_b'), step('prov_c')], deps);
      await wrapper.generateStream(MESSAGES);
      expect(received).to.deep.equal(['Hello', ' world']); // C's chunks
      expect(errors).to.be.empty;
      expect(deps.recorded).to.have.length(2);
      expect(deps.recorded[0]).to.include({ providerId: 'prov_a', fallbackProviderId: 'prov_b' });
      expect(deps.recorded[1]).to.include({ providerId: 'prov_b', fallbackProviderId: 'prov_c' });
      // Only the transition INTO the serving provider (B→C) is marked succeeded.
      expect(deps.marked).to.deep.equal(['fbev_2']);
    });
  });

  describe('setup-phase retry', () => {
    it('timeout gets one 500 ms retry on the same provider before moving on', async () => {
      a.behavior = 'fail-setup';
      a.setupError = TIMEOUT_ERROR();
      const { wrapper } = makeWrapper('prov_a', a, [step('prov_b')], deps);
      const start = Date.now();
      await wrapper.generateStream(MESSAGES);
      expect(a.generateStreamCalls).to.equal(2); // first + one retry
      expect(b.generateStreamCalls).to.equal(1); // then failover
      expect(Date.now() - start).to.be.at.least(450);
    });

    it('server_error gets one retry', async () => {
      a.behavior = 'fail-setup';
      a.setupError = SERVER_ERROR();
      const { wrapper } = makeWrapper('prov_a', a, [step('prov_b')], deps);
      await wrapper.generateStream(MESSAGES);
      expect(a.generateStreamCalls).to.equal(2);
    });

    it('auth failure does NOT retry — straight to the next provider', async () => {
      a.behavior = 'fail-setup';
      a.setupError = AUTH_ERROR();
      const { wrapper } = makeWrapper('prov_a', a, [step('prov_b')], deps);
      await wrapper.generateStream(MESSAGES);
      expect(a.generateStreamCalls).to.equal(1);
      expect(b.generateStreamCalls).to.equal(1);
    });

    it('retry succeeds on the same provider — no failover event', async () => {
      // First attempt times out, retry (same fake, now ok) serves.
      let calls = 0;
      const flaky = new FakeLlm('prov_a');
      flaky.behavior = 'ok';
      const origStream = flaky.generateStream.bind(flaky);
      flaky.generateStream = async (...args) => {
        calls += 1;
        if (calls === 1) {
          if (flaky.errorCb) await flaky.errorCb(TIMEOUT_ERROR());
          throw TIMEOUT_ERROR();
        }
        return origStream(...args);
      };
      const d = makeDeps({ prov_a: flaky, prov_b: b });
      const { wrapper, received, errors } = makeWrapper('prov_a', flaky, [step('prov_b')], d);
      await wrapper.generateStream(MESSAGES);
      expect(received).to.deep.equal(['Hello', ' world']);
      expect(errors).to.be.empty;
      expect(b.generateStreamCalls).to.equal(0);
      expect(d.recorded).to.be.empty;
      expect(d.marked).to.be.empty;
    });
  });

  describe('non-streaming generate()', () => {
    it('fails over on any failure (all failures are setup-phase)', async () => {
      a.behavior = 'fail-setup';
      a.setupError = makeError(400, undefined, 'bad request'); // client_error: no retry
      const { wrapper, errors } = makeWrapper('prov_a', a, [step('prov_b')], deps);
      const result = await wrapper.generate(MESSAGES);
      expect(a.generateCalls).to.equal(1);
      expect(b.generateCalls).to.equal(1);
      expect(result.id).to.equal('gen_prov_b');
      expect(errors).to.be.empty;
      expect(deps.recorded).to.have.length(1);
      expect(deps.marked).to.have.length(1);
    });

    it('exhausts and throws the last error', async () => {
      a.behavior = 'fail-setup';
      const bError = makeError(401, undefined, 'B failed');
      b.behavior = 'fail-setup';
      b.setupError = bError;
      const { wrapper, errors } = makeWrapper('prov_a', a, [step('prov_b')], deps);
      try {
        await wrapper.generate(MESSAGES);
        expect.fail('should have thrown');
      } catch (error) {
        expect(error).to.equal(bError);
      }
      expect(errors).to.have.length(1);
    });
  });

  describe('lifecycle', () => {
    it('fallback instances are created lazily and cached', async () => {
      a.behavior = 'fail-setup';
      const { wrapper } = makeWrapper('prov_a', a, [step('prov_b')], deps);
      expect(deps.created).to.be.empty; // nothing instantiated yet
      await wrapper.generateStream(MESSAGES);
      expect(deps.created.map((e) => e.id)).to.deep.equal(['prov_b']);
      // Second call reuses the cached instance (no second factory call).
      a.behavior = 'fail-setup'; // fail again
      await wrapper.generateStream(MESSAGES);
      expect(deps.created).to.have.length(1);
    });

    it('per-step settings override the base settings (base fields preserved)', async () => {
      a.behavior = 'fail-setup';
      const { wrapper } = makeWrapper('prov_a', a, [step('prov_b', { model: 'other-model' })], deps);
      await wrapper.generateStream(MESSAGES);
      expect(deps.created[0].settings).to.deep.equal({ model: 'other-model', temperature: 0.7 });
    });

    it('cleanup forwards to the primary and every created fallback instance', async () => {
      a.behavior = 'fail-setup';
      const { wrapper } = makeWrapper('prov_a', a, [step('prov_b'), step('prov_c')], deps);
      await wrapper.generateStream(MESSAGES);
      expect(a.cleanups).to.equal(0);
      await wrapper.cleanup();
      expect(a.cleanups).to.equal(1);
      expect(b.cleanups).to.equal(1);
      expect(c.cleanups).to.equal(0); // never instantiated
    });

    it('cleanup with no failover touches only the primary', async () => {
      const { wrapper } = makeWrapper('prov_a', a, [step('prov_b')], deps);
      await wrapper.generateStream(MESSAGES);
      await wrapper.cleanup();
      expect(a.cleanups).to.equal(1);
      expect(b.cleanups).to.equal(0);
    });

    it('enumerateModels and moderateUserInput delegate to the primary only', async () => {
      const { wrapper } = makeWrapper('prov_a', a, [step('prov_b')], deps);
      await wrapper.enumerateModels();
      await wrapper.moderateUserInput('hello');
      expect(a.modelsCalls).to.equal(1);
      expect(a.moderateCalls).to.equal(1);
      expect(b.modelsCalls).to.equal(0);
      expect(b.moderateCalls).to.equal(0);
    });

    it('exposes the primary id and chain size', () => {
      const { wrapper } = makeWrapper('prov_a', a, [step('prov_b'), step('prov_c')], deps);
      expect(wrapper.primaryId).to.equal('prov_a');
      expect(wrapper.providerCount).to.equal(3);
    });
  });
});

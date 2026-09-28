import 'reflect-metadata';
import { describe, it } from 'mocha';
import { expect } from 'chai';
import { StreamStats } from '../../../src/services/monitoring/StreamStats';
import { CallLogger } from '../../../src/services/monitoring/CallLogger';
import { MetricsRegistry } from '../../../src/services/monitoring/MetricsRegistry';
import { MonitoringContext } from '../../../src/services/monitoring/MonitoringContext';
import { ProviderCallRecorder, trackWebhookOutcome, resetMonitoringAccessorsForTests } from '../../../src/services/monitoring/ProviderCallRecorder';
import { container } from 'tsyringe';
import { TwilioMessagingConnection } from '../../../src/channels/twilio-messaging/TwilioMessagingConnection';
import { ImapMailboxSession } from '../../../src/services/ImapInboundService';
import { OAuth2TokenRefreshService } from '../../../src/services/OAuth2TokenRefreshService';
import { LlmProviderBase } from '../../../src/services/providers/llm/LlmProviderBase';
import type { LlmMessage, LlmGenerationResult } from '../../../src/services/providers/llm/ILlmProvider';
import { TtsProviderBase } from '../../../src/services/providers/tts/TtsProviderBase';
import type { GeneratedAudioChunk } from '../../../src/services/providers/tts/ITtsProvider';
import { AsrProviderBase } from '../../../src/services/providers/asr/AsrProviderBase';
import { StorageProviderBase } from '../../../src/services/providers/storage/StorageProviderBase';
import type { AudioFormat } from '../../../src/types/audio';

class QuietCallLogger extends CallLogger {
  rows: any[] = [];
  protected async persistRows(rows: any[]): Promise<void> {
    this.rows.push(...rows);
  }
  protected onFlushError(err: unknown): void { /* swallow */ }
}

class QuietRegistry extends MetricsRegistry {
  protected async persistRows(rows: any[]): Promise<void> { /* no DB in unit tests */ }
  protected onFlushError(err: unknown): void { /* swallow */ }
}

/**
 * Shared quiet logger for the container-backed tests below. The container-
 * resolved ProviderCallRecorder is a singleton and keeps the CallLogger it
 * first received, so every describe that redirects container resolution must
 * register this same instance.
 */
const sharedCallLogger = new QuietCallLogger();

/** Minimal concrete LLM provider for exercising the base template wrappers. */
class FakeLlmProvider extends LlmProviderBase<Record<string, unknown>> {
  public nextResult: LlmGenerationResult = {
    id: 'fake_1',
    content: [{ contentType: 'text', text: 'hi' }],
    role: 'assistant',
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };
  public nextError: Error | null = null;
  public streamChunks: string[] = [];
  public generateCalls = 0;
  public streamCalls = 0;
  /** Test seams: redirect recording/publication away from the container. */
  public testRecorder: { record(entry: any): void } | null = null;
  public testRegistry: MetricsRegistry | null = null;

  constructor() { super({}); }

  protected resolveCallRecorder(): { record(entry: any): void } {
    if (this.testRecorder) return this.testRecorder;
    return super.resolveCallRecorder();
  }

  protected resolveMetricsRegistry(): MetricsRegistry | null {
    if (this.testRegistry) return this.testRegistry;
    return super.resolveMetricsRegistry();
  }

  protected async doGenerate(_messages: LlmMessage[], _options?: unknown): Promise<LlmGenerationResult> {
    this.generateCalls += 1;
    if (this.nextError) throw this.nextError;
    return this.nextResult;
  }

  protected async doGenerateStream(_messages: LlmMessage[], _options?: unknown): Promise<void> {
    this.streamCalls += 1;
    for (const chunk of this.streamChunks) {
      await this.notifyChunk(chunk, this.nextResult.id, 'assistant', undefined, this.nextResult.usage);
    }
    if (this.nextError) throw this.nextError; // after chunks → exercises the mid_stream path
    await this.notifyComplete(this.nextResult);
  }

  protected async doEnumerateModels(): Promise<never[]> { return []; }
}

const MESSAGES: LlmMessage[] = [
  { role: 'system', content: 'Be nice' },
  { role: 'user', content: 'Hello' },
];

describe('StreamStats (P1-03)', () => {
  it('ttftMs is null before the first unit and correct after', () => {
    const stats = new StreamStats('llm.generate', 1000);
    expect(stats.ttftMs).to.equal(null);
    stats.onUnit(1080);
    expect(stats.ttftMs).to.equal(80);
  });

  it('tracks chunk count, max gap and delivery flag across timing fixtures', () => {
    const stats = new StreamStats('llm.generate', 0);
    stats.onUnit(10); // first chunk — no gap
    stats.onUnit(30); // gap 20
    stats.onUnit(200); // gap 170 (max)
    stats.onUnit(250); // gap 50
    expect(stats.chunksCount).to.equal(4);
    expect(stats.delivered).to.be.true;
    expect(stats.maxChunkGapMs).to.equal(170);
    expect(stats.firstChunkAt).to.equal(10);
    expect(stats.lastChunkAt).to.equal(250);
  });

  it('toCallMetrics() includes only set fields (camelCase keys)', () => {
    const stats = new StreamStats('llm.generate', 0);
    expect(stats.toCallMetrics()).to.deep.equal({});

    stats.onUnit(100);
    stats.onUnit(150);
    stats.finishReason = 'stop';
    stats.tokensPrompt = 42;
    stats.tokensCompletion = 7;
    expect(stats.toCallMetrics()).to.deep.equal({
      ttftMs: 100,
      chunksCount: 2,
      maxChunkGapMs: 50,
      finishReason: 'stop',
      tokensPrompt: 42,
      tokensCompletion: 7,
    });
  });

  it('durationMs is clamped to >= 0', () => {
    const stats = new StreamStats('llm.generate', 5000);
    expect(stats.durationMs(1000)).to.equal(0);
    expect(stats.durationMs(6500)).to.equal(1500);
  });
});

describe('ProviderCallRecorder (P1-03)', () => {
  function makeRecorder() {
    const callLogger = new QuietCallLogger();
    const registry = new QuietRegistry();
    const recorder = new ProviderCallRecorder(callLogger, registry);
    return { callLogger, registry, recorder };
  }

  it('records a successful call: row + provider_calls_total + provider_call_duration_ms', async () => {
    const { callLogger, registry, recorder } = makeRecorder();
    recorder.record({
      providerId: 'prov_1',
      providerType: 'llm',
      apiType: 'openai',
      operation: 'llm.generate',
      durationMs: 123,
      ok: true,
      metrics: { ttftMs: 40, chunksCount: 2 },
    });
    await callLogger.flushNow();

    expect(callLogger.rows.length).to.equal(1);
    const row = callLogger.rows[0];
    expect(row.providerId).to.equal('prov_1');
    expect(row.operation).to.equal('llm.generate');
    expect(row.ok).to.equal(true);
    expect(row.errorCode).to.equal(null);
    expect(row.durationMs).to.equal(123);
    expect(row.metrics).to.deep.equal({ ttftMs: 40, chunksCount: 2 });

    const snap = registry.snapshot();
    // series keys are sorted alphabetically by label name
    const label = 'error_code=none,ok=true,operation=llm.generate,provider_id=prov_1,provider_type=llm';
    expect(snap.counters.provider_calls_total[label]?.count).to.equal(1);
    const hist = snap.histograms.provider_call_duration_ms[label];
    expect(hist?.count).to.equal(1);
    expect(hist?.sum).to.equal(123);
  });

  it('classifies failed calls (429 → rate_limited with statusHttp)', async () => {
    const { callLogger, recorder } = makeRecorder();
    const error = new Error('rate limit') as Error & { status: number };
    error.status = 429;
    recorder.record({
      providerId: 'prov_1',
      providerType: 'llm',
      apiType: 'openai',
      operation: 'llm.generate',
      durationMs: 10,
      ok: false,
      error,
    });
    await callLogger.flushNow();

    expect(callLogger.rows.length).to.equal(1);
    expect(callLogger.rows[0].errorCode).to.equal('rate_limited');
    expect(callLogger.rows[0].statusHttp).to.equal(429);
    expect(callLogger.rows[0].errorText).to.contain('rate limit');
  });

  it('fills projectId/conversationId/operation from MonitoringContext when absent', async () => {
    const { callLogger, recorder } = makeRecorder();
    MonitoringContext.run(
      { projectId: 'proj_ctx', conversationId: 'conv_ctx', operation: 'llm.classify' },
      () => {
        recorder.record({
          providerId: 'prov_1',
          providerType: 'llm',
          apiType: 'openai',
          durationMs: 5,
          ok: true,
        });
      },
    );
    await callLogger.flushNow();

    expect(callLogger.rows.length).to.equal(1);
    expect(callLogger.rows[0].operation).to.equal('llm.classify');
    expect(callLogger.rows[0].projectId).to.equal('proj_ctx');
    expect(callLogger.rows[0].conversationId).to.equal('conv_ctx');
  });

  it('drops invalid entries and never throws', async () => {
    const { callLogger, recorder } = makeRecorder();
    expect(() => recorder.record({} as any)).to.not.throw();
    expect(() => recorder.record({ providerId: '', providerType: 'llm', apiType: 'openai', ok: true, durationMs: 1 } as any)).to.not.throw();
    expect(() => recorder.record({ providerId: 'p', providerType: 'llm', apiType: 'openai', ok: true, durationMs: NaN } as any)).to.not.throw();
    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(0);
  });
});

describe('trackWebhookOutcome (P1-03)', () => {
  function fakeRes(statusCode: number) {
    const listeners: Record<string, Array<() => void>> = {};
    return {
      statusCode,
      on(event: string, listener: () => void) {
        (listeners[event] ??= []).push(listener);
        return this;
      },
      fireFinish() {
        (listeners.finish ?? []).forEach((fn) => fn());
      },
    };
  }

  it('records a channel.webhook row with the returned status on finish (failure case)', async () => {
    const callLogger = new QuietCallLogger();
    const recorder = new ProviderCallRecorder(callLogger, new QuietRegistry());
    const res = fakeRes(401);

    trackWebhookOutcome(res, 'prov_ch', 'telegram', recorder);
    res.fireFinish();
    await callLogger.flushNow();

    expect(callLogger.rows.length).to.equal(1);
    const row = callLogger.rows[0];
    expect(row.operation).to.equal('channel.webhook');
    expect(row.apiType).to.equal('telegram');
    expect(row.statusHttp).to.equal(401);
    expect(row.ok).to.equal(false);
  });

  it('records ok=true for a 200 response', async () => {
    const callLogger = new QuietCallLogger();
    const recorder = new ProviderCallRecorder(callLogger, new QuietRegistry());
    const res = fakeRes(200);

    trackWebhookOutcome(res, 'prov_ch', 'whatsapp', recorder);
    res.fireFinish();
    await callLogger.flushNow();

    expect(callLogger.rows.length).to.equal(1);
    expect(callLogger.rows[0].ok).to.equal(true);
    expect(callLogger.rows[0].errorCode).to.equal(null);
  });

  it('skips when the provider id is empty and never throws on finish', async () => {
    const callLogger = new QuietCallLogger();
    const recorder = new ProviderCallRecorder(callLogger, new QuietRegistry());
    const res = fakeRes(500);

    expect(() => {
      trackWebhookOutcome(res, '', 'whatsapp', recorder);
      res.fireFinish();
    }).to.not.throw();
    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(0);
  });
});

describe('LlmProviderBase instrumentation (P1-03)', () => {
  function makeProvider() {
    const callLogger = new QuietCallLogger();
    const registry = new QuietRegistry();
    const recorder = new ProviderCallRecorder(callLogger, registry);
    const provider = new FakeLlmProvider();
    provider.providerId = 'prov_llm';
    provider.providerApiType = 'openai';
    provider.providerModel = 'fake-model';
    provider.testRecorder = recorder;
    provider.testRegistry = registry;
    return { callLogger, registry, recorder, provider };
  }

  it('generate() records one row with tokens and ok=true', async () => {
    const { callLogger, provider } = makeProvider();
    await provider.generate(MESSAGES);
    expect(provider.generateCalls).to.equal(1);
    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(1);
    const row = callLogger.rows[0];
    expect(row.operation).to.equal('llm.generate');
    expect(row.ok).to.equal(true);
    expect(row.model).to.equal('fake-model');
    expect(row.metrics?.tokensPrompt).to.equal(10);
    expect(row.metrics?.tokensCompletion).to.equal(5);
    expect(row.metrics?.finishReason).to.equal('stop');
  });

  it('generate() failure records errorPhase=setup and classified error', async () => {
    const { callLogger, provider } = makeProvider();
    const error = new Error('boom') as Error & { status: number };
    error.status = 500;
    provider.nextError = error;
    let threw = false;
    try { await provider.generate(MESSAGES); } catch { threw = true; }
    expect(threw).to.equal(true);
    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(1);
    expect(callLogger.rows[0].ok).to.equal(false);
    expect(callLogger.rows[0].errorCode).to.equal('server_error');
    expect(callLogger.rows[0].statusHttp).to.equal(500);
    expect(callLogger.rows[0].metrics?.errorPhase).to.equal('setup');
  });

  it('generateStream() records streaming phase fields from the notify hooks', async () => {
    const { callLogger, registry, provider } = makeProvider();
    provider.streamChunks = ['a', 'b', 'c'];
    await provider.generateStream(MESSAGES);
    expect(provider.streamCalls).to.equal(1);
    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(1);
    const row = callLogger.rows[0];
    expect(row.ok).to.equal(true);
    expect(row.metrics?.chunksCount).to.equal(3);
    expect(row.metrics?.ttftMs).to.be.a('number').and.to.be.gte(0);
    expect(row.metrics?.finishReason).to.equal('stop');

    const snap = registry.snapshot();
    const label = 'error_code=none,ok=true,operation=llm.generate,provider_id=prov_llm,provider_type=llm';
    expect(snap.histograms.llm_ttft_ms[label]?.count).to.equal(1);
    expect(snap.histograms.llm_stream_duration_ms[label]?.count).to.equal(1);
  });

  it('generateStream() failure after chunks records errorPhase=mid_stream', async () => {
    const { callLogger, provider } = makeProvider();
    provider.streamChunks = ['a'];
    provider.nextError = new Error('stream died');
    let threw = false;
    try { await provider.generateStream(MESSAGES); } catch { threw = true; }
    expect(threw).to.equal(true);
    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(1);
    expect(callLogger.rows[0].ok).to.equal(false);
    expect(callLogger.rows[0].metrics?.errorPhase).to.equal('mid_stream');
  });

  it('nested MonitoringContext llm.* operation overrides the default', async () => {
    const { callLogger, provider } = makeProvider();
    await MonitoringContext.run(
      { projectId: 'proj_op', operation: 'llm.classify' },
      () => provider.generate(MESSAGES),
    );
    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(1);
    expect(callLogger.rows[0].operation).to.equal('llm.classify');
    expect(callLogger.rows[0].projectId).to.equal('proj_op');
  });

  it('non-llm context operation falls back to llm.generate', async () => {
    const { callLogger, provider } = makeProvider();
    await MonitoringContext.run({ operation: 'something.else' }, () => provider.generate(MESSAGES));
    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(1);
    expect(callLogger.rows[0].operation).to.equal('llm.generate');
  });

  it('no recording when provider identity is not stamped (factory-less construction)', async () => {
    // Without providerId/providerApiType the base's recordCall is a no-op —
    // direct (non-factory) constructions never produce orphan rows.
    const provider = new FakeLlmProvider();
    await provider.generate(MESSAGES);
    expect(provider.generateCalls).to.equal(1); // business path unaffected
  });
});

describe('MonitoringContext merge semantics (P1-03)', () => {
  it('nested run() inherits outer fields and overrides its own', async () => {
    const seen: unknown[] = [];
    await MonitoringContext.run(
      { projectId: 'proj_t', conversationId: 'conv_t' },
      async () => {
        await MonitoringContext.run({ operation: 'llm.filler' }, () => {
          seen.push(MonitoringContext.current());
        });
        seen.push(MonitoringContext.current());
      },
    );
    expect(seen[0]).to.deep.equal({ projectId: 'proj_t', conversationId: 'conv_t', operation: 'llm.filler' });
    expect(seen[1]).to.deep.equal({ projectId: 'proj_t', conversationId: 'conv_t' });
  });
});

/** Minimal concrete TTS provider for exercising the base template wrappers. */
class FakeTtsProvider extends TtsProviderBase<Record<string, unknown>> {
  public startCalls = 0;
  public endCalls = 0;
  public cancelCalls = 0;
  public sendTextCalls: string[] = [];
  public testRecorder: { record(entry: any): void } | null = null;
  public testRegistry: MetricsRegistry | null = null;

  constructor() { super({}); }

  protected resolveCallRecorder(): { record(entry: any): void } {
    if (this.testRecorder) return this.testRecorder;
    return super.resolveCallRecorder();
  }

  protected resolveMetricsRegistry(): MetricsRegistry | null {
    if (this.testRegistry) return this.testRegistry;
    return super.resolveMetricsRegistry();
  }

  async init(): Promise<void> { /* no-op */ }
  getSupportedFormats(): AudioFormat[] { return ['mp3']; }
  getOutputFormat(): AudioFormat { return 'mp3'; }

  protected async doStart(): Promise<void> { this.startCalls += 1; }
  protected async doEnd(): Promise<void> { this.endCalls += 1; }
  protected async doCancel(): Promise<void> { this.cancelCalls += 1; }
  protected async doSendText(text: string): Promise<void> { this.sendTextCalls.push(text); }

  protected makeChunk(bytes: number, durationMs?: number): GeneratedAudioChunk {
    return { chunkId: `chunk_${Math.random()}`, ordinal: 0, audio: Buffer.alloc(bytes), audioFormat: 'mp3', durationMs, isFinal: false };
  }

  /** Public test hooks over the protected base helpers. */
  emitAudio(bytes: number, durationMs?: number): Promise<void> {
    return this.handleSpeechGenerating(this.makeChunk(bytes, durationMs));
  }
  fail(error: Error): Promise<void> {
    return this.handleError(error);
  }
}

describe('TtsProviderBase instrumentation (P1-03)', () => {
  function makeProvider() {
    const callLogger = new QuietCallLogger();
    const registry = new QuietRegistry();
    const recorder = new ProviderCallRecorder(callLogger, registry);
    const provider = new FakeTtsProvider();
    provider.providerId = 'prov_tts';
    provider.providerApiType = 'elevenlabs';
    provider.testRecorder = recorder;
    provider.testRegistry = registry;
    return { callLogger, registry, provider };
  }

  it('a completed session records one tts.session row with audio metrics + histograms', async () => {
    const { callLogger, registry, provider } = makeProvider();
    await provider.start();
    await provider.emitAudio(100, 250);
    await provider.emitAudio(100, 250);
    await provider.end();
    expect(provider.startCalls).to.equal(1);
    expect(provider.endCalls).to.equal(1);

    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(1);
    const row = callLogger.rows[0];
    expect(row.operation).to.equal('tts.session');
    expect(row.providerType).to.equal('tts');
    expect(row.apiType).to.equal('elevenlabs');
    expect(row.ok).to.equal(true);
    expect(row.metrics?.chunksCount).to.equal(2);
    expect(row.metrics?.audioBytesOut).to.equal(200);
    expect(row.metrics?.audioDurationMs).to.equal(500);

    const snap = registry.snapshot();
    const label = 'error_code=none,ok=true,operation=tts.session,provider_id=prov_tts,provider_type=tts';
    expect(snap.histograms.tts_ttfa_ms[label]?.count).to.equal(1);
    expect(snap.histograms.tts_synthesis_ms[label]?.count).to.equal(1);
  });

  it('a fatal error flushes the row immediately as failed; end() does not double-record', async () => {
    const { callLogger, provider } = makeProvider();
    await provider.start();
    const error = new Error('tts boom') as Error & { status: number };
    error.status = 500;
    await provider.fail(error);
    await provider.end();

    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(1);
    expect(callLogger.rows[0].ok).to.equal(false);
    expect(callLogger.rows[0].errorCode).to.equal('server_error');
    expect(callLogger.rows[0].statusHttp).to.equal(500);
  });

  it('barge-in cancel records ok=true with metrics.canceled=true', async () => {
    const { callLogger, provider } = makeProvider();
    await provider.start();
    await provider.emitAudio(80);
    await provider.cancel();
    expect(provider.cancelCalls).to.equal(1);

    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(1);
    expect(callLogger.rows[0].ok).to.equal(true);
    expect(callLogger.rows[0].metrics?.canceled).to.equal(true);
    expect(callLogger.rows[0].metrics?.chunksCount).to.equal(1);
  });

  it('no recording when provider identity is not stamped', async () => {
    const callLogger = new QuietCallLogger();
    const recorder = new ProviderCallRecorder(callLogger, new QuietRegistry());
    const provider = new FakeTtsProvider();
    provider.testRecorder = recorder;
    await provider.start();
    await provider.end();
    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(0);
    expect(provider.endCalls).to.equal(1); // business path unaffected
  });
});

/** Minimal concrete ASR provider for exercising the base template wrappers. */
class FakeAsrProvider extends AsrProviderBase<Record<string, unknown>> {
  public startCalls = 0;
  public testRecorder: { record(entry: any): void } | null = null;
  public testRegistry: MetricsRegistry | null = null;

  constructor() { super({}); }

  protected resolveCallRecorder(): { record(entry: any): void } {
    if (this.testRecorder) return this.testRecorder;
    return super.resolveCallRecorder();
  }

  protected resolveMetricsRegistry(): MetricsRegistry | null {
    if (this.testRegistry) return this.testRegistry;
    return super.resolveMetricsRegistry();
  }

  getSupportedInputFormats(): AudioFormat[] { return ['pcm_16000']; }
  protected async doStart(): Promise<void> { this.startCalls += 1; }
  protected async doStop(): Promise<void> { /* no-op */ }
  protected async doSendAudio(_audio: Buffer, _format?: AudioFormat): Promise<void> { /* no-op */ }

  /** Public test hooks over the protected base helpers. */
  recognizePartial(chunkId: string, text: string): void { this.handleRecognizing(chunkId, text); }
  recognizeFinal(chunkId: string, text: string): void { this.handleRecognized(chunkId, text); }
  recognitionStopped(): void { this.handleRecognitionStopped(); }
  fail(error: Error): Promise<void> { return this.handleError(error); }
}

describe('AsrProviderBase instrumentation (P1-03)', () => {
  function makeProvider() {
    const callLogger = new QuietCallLogger();
    const registry = new QuietRegistry();
    const recorder = new ProviderCallRecorder(callLogger, registry);
    const provider = new FakeAsrProvider();
    provider.providerId = 'prov_asr';
    provider.providerApiType = 'deepgram';
    provider.testRecorder = recorder;
    provider.testRegistry = registry;
    return { callLogger, registry, provider };
  }

  it('a recognized utterance records one ok asr.session row with phase fields', async () => {
    const { callLogger, registry, provider } = makeProvider();
    await provider.start();
    // 3200 bytes of 16-bit mono 16 kHz PCM = 100 ms
    await provider.sendAudio(Buffer.alloc(3200), 'pcm_16000');
    provider.recognizePartial('p1', 'hel');
    provider.markInputEnded(Date.now());
    provider.recognizeFinal('f1', 'hello');
    provider.recognitionStopped();

    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(1);
    const row = callLogger.rows[0];
    expect(row.operation).to.equal('asr.session');
    expect(row.providerType).to.equal('asr');
    expect(row.ok).to.equal(true);
    expect(row.metrics?.partialsCount).to.equal(1);
    expect(row.metrics?.finalsCount).to.equal(1);
    expect(row.metrics?.setupMs).to.be.a('number').and.to.be.gte(0);
    expect(row.metrics?.timeToFirstPartialMs).to.be.a('number').and.to.be.gte(0);
    expect(row.metrics?.eosToFinalMs).to.be.a('number').and.to.be.gte(0);
    expect(row.metrics?.sessionAudioMs).to.equal(100);

    const snap = registry.snapshot();
    const label = 'error_code=none,ok=true,operation=asr.session,provider_id=prov_asr,provider_type=asr';
    expect(snap.histograms.asr_setup_ms[label]?.count).to.equal(1);
    expect(snap.histograms.asr_eos_to_final_ms[label]?.count).to.equal(1);
  });

  it('a fatal error flushes the row as failed; recognition-stopped does not double-record', async () => {
    const { callLogger, provider } = makeProvider();
    await provider.start();
    const error = new Error('asr boom') as Error & { status: number };
    error.status = 429;
    await provider.fail(error);
    provider.recognitionStopped();

    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(1);
    expect(callLogger.rows[0].ok).to.equal(false);
    expect(callLogger.rows[0].errorCode).to.equal('rate_limited');
  });

  it('a session without any final is recorded with ok=false', async () => {
    const { callLogger, provider } = makeProvider();
    await provider.start();
    provider.recognizePartial('p1', 'he');
    provider.recognitionStopped();

    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(1);
    expect(callLogger.rows[0].ok).to.equal(false);
    expect(callLogger.rows[0].metrics?.finalsCount).to.equal(0);
  });

  it('a new start() flushes the superseded pending session', async () => {
    const { callLogger, provider } = makeProvider();
    await provider.start();
    provider.recognizeFinal('f1', 'stale');
    // Second utterance begins while the first session was never stopped.
    await provider.start();
    provider.recognizeFinal('f2', 'fresh');
    provider.recognitionStopped();

    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(2);
    expect(callLogger.rows[0].ok).to.equal(true); // superseded session had a final
    expect(callLogger.rows[0].metrics?.finalsCount).to.equal(1);
    expect(callLogger.rows[1].ok).to.equal(true);
  });
});

/** Minimal concrete storage provider for exercising the base template wrappers. */
class FakeStorageProvider extends StorageProviderBase<Record<string, unknown>> {
  public uploadError: Error | null = null;
  public testRecorder: { record(entry: any): void } | null = null;

  constructor() { super({}); }

  protected resolveCallRecorder(): { record(entry: any): void } {
    if (this.testRecorder) return this.testRecorder;
    return super.resolveCallRecorder();
  }

  protected async doUpload(key: string, _data: Buffer): Promise<string> {
    if (this.uploadError) throw this.uploadError;
    return `https://storage.example/${key}`;
  }

  protected async doDownload(_key: string): Promise<Buffer> {
    return Buffer.alloc(64);
  }

  async delete(_key: string): Promise<void> { /* no-op */ }
  async getSignedUrl(_key: string, _expiresIn: number): Promise<string> { return 'signed'; }
  async exists(_key: string): Promise<boolean> { return true; }
  async list(_prefix?: string, _maxResults?: number) { return []; }
}

describe('TwilioMessagingConnection instrumentation (P1-03)', () => {
  before(() => {
    container.registerInstance(CallLogger, sharedCallLogger);
    container.registerInstance(MetricsRegistry, new QuietRegistry());
    resetMonitoringAccessorsForTests();
  });

  beforeEach(() => {
    sharedCallLogger.rows.length = 0;
  });

  function makeConnection(failCreate: boolean): TwilioMessagingConnection {
    const create = failCreate
      ? async () => { const e = new Error('auth credentials rejected'); (e as Error & { status: number }).status = 401; throw e; }
      : async () => ({ sid: 'SM123' });
    const connection = new TwilioMessagingConnection('+15550000001', '+15550000002', 'ACtest', 'token', {} as any, 'prov_twilio');
    (connection as any).twilioClient = { messages: { create } };
    return connection;
  }

  const msg = { type: 'end_ai_generation_output', fullText: 'hi there' } as any;

  it('records a channel.send_message row with ok=true on success', async () => {
    await makeConnection(false).sendMessage(msg);
    await sharedCallLogger.flushNow();
    expect(sharedCallLogger.rows.length).to.equal(1);
    expect(sharedCallLogger.rows[0].operation).to.equal('channel.send_message');
    expect(sharedCallLogger.rows[0].providerType).to.equal('channel');
    expect(sharedCallLogger.rows[0].apiType).to.equal('twilio_messaging');
    expect(sharedCallLogger.rows[0].ok).to.equal(true);
  });

  it('records a classified failed row on Twilio auth failure without rethrowing', async () => {
    let threw = false;
    try { await makeConnection(true).sendMessage(msg); } catch { threw = true; }
    expect(threw).to.equal(false); // conversation path unchanged
    await sharedCallLogger.flushNow();
    expect(sharedCallLogger.rows.length).to.equal(1);
    expect(sharedCallLogger.rows[0].ok).to.equal(false);
    expect(sharedCallLogger.rows[0].errorCode).to.equal('auth');
    expect(sharedCallLogger.rows[0].statusHttp).to.equal(401);
  });
});

describe('ImapMailboxSession poll instrumentation (P1-03)', () => {
  before(() => {
    container.registerInstance(CallLogger, sharedCallLogger);
    container.registerInstance(MetricsRegistry, new QuietRegistry());
    resetMonitoringAccessorsForTests();
  });

  beforeEach(() => {
    sharedCallLogger.rows.length = 0;
  });

  function makeSession(): ImapMailboxSession {
    return new ImapMailboxSession(
      'prov_imap', undefined, 'imap.example.com', 993, true, 'user@example.com', 'pass', 60_000,
      'agent@example.com', 'messageId', 'smtp.example.com', 587, true, 'agent@example.com', 'pass',
      undefined, undefined, 'Bonsai/Processed', false, 0, 0,
    );
  }

  it('records an ok imap.poll row with metrics.messagesFound', async () => {
    const session = makeSession();
    (session as any).doRunPollCycle = async () => ({ messagesFound: 3, connectError: null });
    await (session as any).runPollCycle();
    await sharedCallLogger.flushNow();
    expect(sharedCallLogger.rows.length).to.equal(1);
    const row = sharedCallLogger.rows[0];
    expect(row.operation).to.equal('imap.poll');
    expect(row.apiType).to.equal('smtp_imap');
    expect(row.ok).to.equal(true);
    expect(row.metrics?.messagesFound).to.equal(3);
  });

  it('records a failed imap.poll row with the classified connect error', async () => {
    const session = makeSession();
    const err = Object.assign(new Error('connect ECONNREFUSED imap.example.com:993'), { code: 'ECONNREFUSED' });
    (session as any).doRunPollCycle = async () => ({ messagesFound: 0, connectError: err });
    await (session as any).runPollCycle();
    await sharedCallLogger.flushNow();
    expect(sharedCallLogger.rows.length).to.equal(1);
    expect(sharedCallLogger.rows[0].ok).to.equal(false);
    expect(sharedCallLogger.rows[0].errorCode).to.equal('network');
  });
});

describe('OAuth2TokenRefreshService instrumentation (P1-03)', () => {
  const VALID_CONFIG = {
    fromAddress: 'agent@example.com',
    smtp: { host: 'smtp.example.com', port: 587, secure: false, auth: { user: 'agent@example.com', pass: 'pw' } },
    imap: { host: 'imap.example.com', port: 993, secure: true, auth: { user: 'agent@example.com', pass: 'pw' } },
    oauth2: {
      tokenUrl: 'https://oauth2.googleapis.com/token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
      accessToken: 'access-token',
      accessTokenExpiry: Date.now(), // already expired → refresh proceeds
      scope: 'https://www.googleapis.com/auth/gmail.modify',
    },
  };

  function makeService(fetchToken: () => Promise<unknown>) {
    const callLogger = new QuietCallLogger();
    const recorder = new ProviderCallRecorder(callLogger, new QuietRegistry());
    const service = new OAuth2TokenRefreshService({ resolveObject: async (c: unknown) => c } as any, recorder);
    (service as any).fetchToken = fetchToken;
    return { callLogger, service };
  }

  it('records a failed oauth.refresh row and rethrows', async () => {
    const err = new Error('invalid_grant') as Error & { status: number };
    err.status = 400;
    const { callLogger, service } = makeService(async () => { throw err; });
    let threw = false;
    try { await (service as any).processProviderRefresh({ id: 'prov_imap', config: VALID_CONFIG }); } catch { threw = true; }
    expect(threw).to.equal(true);
    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(1);
    const row = callLogger.rows[0];
    expect(row.operation).to.equal('oauth.refresh');
    expect(row.providerId).to.equal('prov_imap');
    expect(row.ok).to.equal(false);
    expect(row.errorCode).to.equal('client_error');
  });

  it('records nothing when the token is not close to expiry (early return)', async () => {
    const config = { ...VALID_CONFIG, oauth2: { ...VALID_CONFIG.oauth2, accessTokenExpiry: Date.now() + 3600_000 } };
    const { callLogger, service } = makeService(async () => ({ access_token: 'new' }));
    await (service as any).processProviderRefresh({ id: 'prov_imap', config });
    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(0);
  });
});

describe('StorageProviderBase instrumentation (P1-03)', () => {
  function makeProvider() {
    const callLogger = new QuietCallLogger();
    const recorder = new ProviderCallRecorder(callLogger, new QuietRegistry());
    const provider = new FakeStorageProvider();
    provider.providerId = 'prov_store';
    provider.providerApiType = 's3';
    provider.testRecorder = recorder;
    return { callLogger, provider };
  }

  it('upload records storage.upload with metrics.bytesOut', async () => {
    const { callLogger, provider } = makeProvider();
    const url = await provider.upload('key1', Buffer.alloc(120));
    expect(url).to.equal('https://storage.example/key1');
    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(1);
    expect(callLogger.rows[0].operation).to.equal('storage.upload');
    expect(callLogger.rows[0].ok).to.equal(true);
    expect(callLogger.rows[0].metrics?.bytesOut).to.equal(120);
  });

  it('download records storage.download with metrics.bytesIn', async () => {
    const { callLogger, provider } = makeProvider();
    const data = await provider.download('key1');
    expect(data.length).to.equal(64);
    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(1);
    expect(callLogger.rows[0].operation).to.equal('storage.download');
    expect(callLogger.rows[0].metrics?.bytesIn).to.equal(64);
  });

  it('an upload failure records ok=false with the classified error and rethrows', async () => {
    const { callLogger, provider } = makeProvider();
    const error = new Error('forbidden') as Error & { status: number };
    error.status = 403;
    provider.uploadError = error;
    let threw = false;
    try { await provider.upload('key1', Buffer.alloc(10)); } catch { threw = true; }
    expect(threw).to.equal(true);
    await callLogger.flushNow();
    expect(callLogger.rows.length).to.equal(1);
    expect(callLogger.rows[0].ok).to.equal(false);
    expect(callLogger.rows[0].errorCode).to.equal('auth');
    expect(callLogger.rows[0].statusHttp).to.equal(403);
  });
});

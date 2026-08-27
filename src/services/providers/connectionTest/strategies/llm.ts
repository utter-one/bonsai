import { container } from 'tsyringe';
import { ValidationError } from '../../../../errors';
import type { ILlmProvider, LlmMessage } from '../../llm/ILlmProvider';
import { LlmProviderFactory, type LlmSettings } from '../../llm/LlmProviderFactory';
import type { ConnectionTestContext, ConnectionTestOutcome, ConnectionTestRequest, ConnectionTestStrategy } from '../types';

/** Hard timeout for the whole LLM test body (TPC-01 guard table). */
const LLM_TEST_TIMEOUT_MS = 30_000;

/** Fresh per-test state built by the strategy (the tester bounds cleanup on it). */
export interface LlmTestInstance {
  llm: ILlmProvider;
  /** The model actually exercised (saved: input or first enumerated · draft: required input). */
  model: string;
  /** Delegates to the provider (the tester's boundedCleanup calls instance.cleanup). */
  cleanup(): Promise<void>;
}

/**
 * LLM connection strategy (TPC-02): verify auth + availability with a
 * 1-token real completion through the production template wrapper — the same
 * HTTP path, headers and request shape a conversation uses (`maxTokens: 1`,
 * the same minimum a live turn costs; rationale: `llmProbe: 'one_token'` in
 * HealthCheckService).
 *
 * All 16 apiTypes are covered by construction — the factory maps them, the
 * strategy contains no per-vendor code. Vendor failures escape as raw errors
 * and are classified by the tester (auth / rate_limited / network /
 * server_error / timeout). The production wrapper records the test's own
 * `llm.test` call-log row under the tester's monitoring context
 * (breaker-excluded); draft instances are un-stamped and record nothing.
 *
 * Model selection: saved mode — `model` input, defaulting to the first model
 * from `enumerateModels()` (the existing free call); draft mode — `model`
 * required (ValidationError → 400).
 */
export function buildLlmConnectionTestStrategy(): ConnectionTestStrategy<LlmTestInstance> {
  return {
    providerType: 'llm',
    timeoutMs: LLM_TEST_TIMEOUT_MS,
    protocol: 'http',

    async buildInstance(request: ConnectionTestRequest, _ctx: ConnectionTestContext): Promise<LlmTestInstance> {
      const factory = container.resolve(LlmProviderFactory);
      let model = request.model;
      if (!model) {
        if (request.mode === 'draft') {
          // A draft has no row to enumerate against — the caller must name the model.
          throw new ValidationError('A model is required to test a draft LLM provider', []);
        }
        model = await defaultModelFromCatalog(factory, request);
        if (!model) {
          throw new ValidationError(`Could not determine a model for provider ${request.provider.id} — pass 'model' explicitly`, []);
        }
      }
      // Fresh, initialized instance (secrets resolved; draft → un-stamped, no call-log rows).
      const llm = await factory.createForTest(request.provider, { model } as LlmSettings);
      return { llm, model, cleanup: () => llm.cleanup() };
    },

    async test(request: ConnectionTestRequest, instance: LlmTestInstance, _ctx: ConnectionTestContext): Promise<ConnectionTestOutcome> {
      // The production wrapper (LlmProviderBase.generate) times the call and
      // records the 'llm.test' row — this is the same path a conversation uses.
      // System-first: several apiTypes validate that (LlmProviderBase.validateMessages).
      const messages: LlmMessage[] = [
        { role: 'system', content: 'You are a connectivity check. Reply with a single word.' },
        { role: 'user', content: 'ping' },
      ];
      await instance.llm.generate(messages, { maxTokens: 1 });
      return {
        ok: true,
        providerType: request.providerType,
        apiType: request.apiType,
        protocol: 'http',
        phase: 'first-data',
        latencyMs: 0, // tester-owned (total elapsed) — placeholder for the internal shape
        errorCode: null,
        model: instance.model,
        detail: { model: instance.model },
      };
    },
  };
}

/**
 * Defaults the tested model via the provider's own model catalog — the
 * existing free call (same path as the provider editor's model list):
 * uninitialised enumeration instance → init() (client construction, no
 * network) → enumerateModels() → first model id.
 */
async function defaultModelFromCatalog(factory: LlmProviderFactory, request: ConnectionTestRequest): Promise<string | undefined> {
  const enumerator = await factory.createProviderForEnumeration(request.provider);
  try {
    await enumerator.init();
    const models = await enumerator.enumerateModels();
    return models[0]?.id;
  } finally {
    await enumerator.cleanup();
  }
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Provider } from '../../../src/types/models';
import type { LlmSettings } from '../../../src/services/providers/llm/LlmProviderFactory';

vi.mock('../../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockResolveObject = vi.fn((obj: Record<string, unknown>) => Promise.resolve(obj));

vi.mock('../../../src/services/secrets/SecretRefUtils', () => ({
  SecretRefUtils: vi.fn().mockImplementation(() => ({
    resolveObject: mockResolveObject,
  })),
}));

import { LlmProviderFactory } from '../../../src/services/providers/llm/LlmProviderFactory';
import type { OpenAILlmSettings } from '../../../src/services/providers/llm/OpenAILlmProvider';
import type { AnthropicLlmSettings } from '../../../src/services/providers/llm/AnthropicLlmProvider';

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'prov_test001',
    name: 'Test Provider',
    description: null,
    providerType: 'llm',
    apiType: 'openai',
    config: { apiKey: 'sk-test-key' },
    createdBy: null,
    tags: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('LlmProviderFactory', () => {
  let factory: LlmProviderFactory;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveObject.mockImplementation((obj: Record<string, unknown>) => Promise.resolve(obj));
    factory = new LlmProviderFactory({ resolveObject: mockResolveObject } as any);
  });

  describe('createProvider', () => {
    it('throws when providerType is not llm', async () => {
      const provider = createProvider({ providerType: 'tts' });
      await expect(factory.createProvider(provider, {} as LlmSettings)).rejects.toThrow(
        "Provider prov_test001 is not an LLM provider. Expected providerType 'llm', got 'tts'"
      );
    });

    it('throws when model is missing from settings', async () => {
      const provider = createProvider();
      await expect(factory.createProvider(provider, {} as LlmSettings)).rejects.toThrow(
        'Invalid LLM provider settings for provider prov_test001. Required field: model'
      );
    });

    it('creates an OpenAI provider with valid config', async () => {
      const provider = createProvider({
        apiType: 'openai',
        config: { apiKey: 'sk-test-key' },
      });
      const settings: OpenAILlmSettings = { model: 'gpt-4' };
      const result = await factory.createProvider(provider, settings as LlmSettings);
      expect(result).toBeDefined();
      expect(mockResolveObject).toHaveBeenCalled();
    });

    it('creates an Anthropic provider with valid config', async () => {
      const provider = createProvider({
        apiType: 'anthropic',
        config: { apiKey: 'sk-ant-test' },
      });
      const settings: AnthropicLlmSettings = { model: 'claude-sonnet-4-5' };
      const result = await factory.createProvider(provider, settings as LlmSettings);
      expect(result).toBeDefined();
    });

    it('creates a Gemini provider with valid config', async () => {
      const provider = createProvider({
        apiType: 'gemini',
        config: { apiKey: 'gemini-key' },
      });
      const result = await factory.createProvider(provider, { model: 'gemini-pro' } as LlmSettings);
      expect(result).toBeDefined();
    });

    it('creates a Groq provider with valid config', async () => {
      const provider = createProvider({
        apiType: 'groq',
        config: { apiKey: 'grok-key' },
      });
      const result = await factory.createProvider(provider, { model: 'llama3-8b' } as LlmSettings);
      expect(result).toBeDefined();
    });

    it('creates providers for all supported API types', async () => {
      const supportedTypes = factory.getSupportedApiTypes();
      expect(supportedTypes).toContain('openai');
      expect(supportedTypes).toContain('openai-legacy');
      expect(supportedTypes).toContain('anthropic');
      expect(supportedTypes).toContain('gemini');
      expect(supportedTypes).toContain('groq');
      expect(supportedTypes).toContain('mistral');
      expect(supportedTypes).toContain('deepseek');
      expect(supportedTypes).toContain('openrouter');
      expect(supportedTypes).toContain('together-ai');
      expect(supportedTypes).toContain('fireworks-ai');
      expect(supportedTypes).toContain('perplexity');
      expect(supportedTypes).toContain('cohere');
      expect(supportedTypes).toContain('xai');
      expect(supportedTypes).toContain('ollama');
    });

    it('throws for unsupported API type', async () => {
      const provider = createProvider({ apiType: 'unknown-provider' as any });
      await expect(factory.createProvider(provider, { model: 'test' } as LlmSettings)).rejects.toThrow(
        'Unsupported LLM provider API type: unknown-provider'
      );
    });

    it('rejects missing required config fields for OpenAI', async () => {
      const provider = createProvider({
        apiType: 'openai',
        config: {},
      });
      await expect(
        factory.createProvider(provider, { model: 'gpt-4' } as LlmSettings)
      ).rejects.toThrow();
    });

    it('rejects missing required config fields for Anthropic', async () => {
      const provider = createProvider({
        apiType: 'anthropic',
        config: {},
      });
      await expect(
        factory.createProvider(provider, { model: 'claude-sonnet-4-5' } as LlmSettings)
      ).rejects.toThrow();
    });

    it('resolves secret references before provider creation', async () => {
      const resolvedConfig = { apiKey: 'resolved-api-key' };
      mockResolveObject.mockResolvedValue(resolvedConfig);
      const provider = createProvider({
        apiType: 'openai',
        config: { apiKey: '@sec:default:secret-id' },
      });
      await factory.createProvider(provider, { model: 'gpt-4' } as LlmSettings);
      expect(mockResolveObject).toHaveBeenCalledWith({ apiKey: '@sec:default:secret-id' });
    });

    it('creates provider with openai-legacy API type', async () => {
      const provider = createProvider({
        apiType: 'openai-legacy',
        config: { apiKey: 'sk-legacy-key' },
      });
      const result = await factory.createProvider(provider, { model: 'gpt-4' } as LlmSettings);
      expect(result).toBeDefined();
    });

    it('creates providers for remaining API types', async () => {
      const configs: Record<string, Record<string, unknown>> = {
        'mistral': { apiKey: 'mistral-key' },
        'deepseek': { apiKey: 'deepseek-key' },
        'openrouter': { apiKey: 'openrouter-key' },
        'together-ai': { apiKey: 'together-key' },
        'fireworks-ai': { apiKey: 'fireworks-key' },
        'perplexity': { apiKey: 'perplexity-key' },
        'cohere': { apiKey: 'cohere-key' },
        'xai': { apiKey: 'xai-key' },
        'ollama': { baseUrl: 'http://localhost:11434' },
      };

      for (const [apiType, config] of Object.entries(configs)) {
        const provider = createProvider({ apiType: apiType as any, config });
        const result = await factory.createProvider(provider, { model: 'test-model' } as LlmSettings);
        expect(result).toBeDefined();
      }
    });
  });

  describe('createProviderForEnumeration', () => {
    it('creates a provider for enumeration without requiring model', async () => {
      const provider = createProvider({
        apiType: 'openai',
        config: { apiKey: 'sk-test-key' },
      });
      const result = await factory.createProviderForEnumeration(provider);
      expect(result).toBeDefined();
    });

    it('throws for enumeration when providerType is not llm', async () => {
      const provider = createProvider({ providerType: 'asr' });
      await expect(factory.createProviderForEnumeration(provider)).rejects.toThrow(
        "Provider prov_test001 is not an LLM provider"
      );
    });

    it('resolves secrets during enumeration provider creation', async () => {
      const provider = createProvider({
        apiType: 'openai',
        config: { apiKey: '@sec:default:key' },
      });
      await factory.createProviderForEnumeration(provider);
      expect(mockResolveObject).toHaveBeenCalled();
    });
  });

  describe('isValidLlmProvider', () => {
    it('returns true for valid LLM provider with supported API type', () => {
      const provider = createProvider({ providerType: 'llm', apiType: 'openai' });
      expect(factory.isValidLlmProvider(provider)).toBe(true);
    });

    it('returns false when providerType is not llm', () => {
      const provider = createProvider({ providerType: 'tts' });
      expect(factory.isValidLlmProvider(provider)).toBe(false);
    });

    it('returns false for unsupported API type', () => {
      const provider = createProvider({ providerType: 'llm', apiType: 'unsupported' as any });
      expect(factory.isValidLlmProvider(provider)).toBe(false);
    });

    it('returns true for all supported API types', () => {
      const supportedTypes = factory.getSupportedApiTypes();
      for (const apiType of supportedTypes) {
        const provider = createProvider({ providerType: 'llm', apiType });
        expect(factory.isValidLlmProvider(provider)).toBe(true);
      }
    });
  });

  describe('getSupportedApiTypes', () => {
    it('returns a non-empty array of supported types', () => {
      const types = factory.getSupportedApiTypes();
      expect(types.length).toBeGreaterThan(0);
    });

    it('returns consistent results across calls', () => {
      const first = factory.getSupportedApiTypes();
      const second = factory.getSupportedApiTypes();
      expect(first).toEqual(second);
    });
  });
});

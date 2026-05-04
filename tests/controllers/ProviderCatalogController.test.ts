import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ProviderCatalogController } from '../../src/http/controllers/ProviderCatalogController';
import type { AsrProviderInfo, TtsProviderInfo, LlmProviderInfo, StorageProviderInfo, ModerationProviderInfo, ProviderCatalog } from '../../services/providers/ProviderCatalogService';

describe('ProviderCatalogController', () => {
  let controller: ProviderCatalogController;
  let mockService: any;

  const mockAsrProvider: AsrProviderInfo = {
    apiType: 'azure',
    displayName: 'Azure Speech Services',
    models: [],
    languages: [{ code: 'en-US', displayName: 'English (US)' }],
  };

  const mockTtsProvider: TtsProviderInfo = {
    apiType: 'elevenlabs',
    displayName: 'ElevenLabs',
    models: [],
    voices: [],
    languages: [{ code: 'en', displayName: 'English' }],
  };

  const mockLlmProvider: LlmProviderInfo = {
    apiType: 'openai',
    displayName: 'OpenAI',
    models: [],
  };

  const mockStorageProvider: StorageProviderInfo = {
    apiType: 's3',
    displayName: 'AWS S3',
  };

  const mockModerationProvider: ModerationProviderInfo = {
    apiType: 'openai',
    displayName: 'OpenAI Moderation',
    models: [],
  };

  const mockCatalog: ProviderCatalog = {
    asr: [mockAsrProvider],
    tts: [mockTtsProvider],
    llm: [mockLlmProvider],
    storage: [mockStorageProvider],
    moderation: [mockModerationProvider],
    channel: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockService = {
      getCatalog: vi.fn().mockReturnValue(mockCatalog),
      getAsrProvider: vi.fn().mockImplementation((apiType: string) => [mockAsrProvider].find((p) => p.apiType === apiType)),
      getTtsProvider: vi.fn().mockImplementation((apiType: string) => [mockTtsProvider].find((p) => p.apiType === apiType)),
      getLlmProvider: vi.fn().mockImplementation((apiType: string) => [mockLlmProvider].find((p) => p.apiType === apiType)),
      getStorageProvider: vi.fn().mockImplementation((apiType: string) => [mockStorageProvider].find((p) => p.apiType === apiType)),
      getModerationProvider: vi.fn().mockImplementation((apiType: string) => [mockModerationProvider].find((p) => p.apiType === apiType)),
    };

    controller = new ProviderCatalogController(mockService);
  });

  describe('getCatalog', () => {
    it('returns complete provider catalog with 200 status', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await (controller as any).getCatalog(req, res);

      expect(mockService.getCatalog).toHaveBeenCalledWith();
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toEqual(mockCatalog);
    });

    it('does not require authentication', async () => {
      const req = createMockRequest({ user: undefined });
      const res = createMockResponse();

      await expect((controller as any).getCatalog(req, res)).resolves.not.toThrow();
      expect((res as MockResponse).statusCode).toBe(200);
    });
  });

  describe('getAsrProviders', () => {
    it('returns ASR providers with 200 status', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await (controller as any).getAsrProviders(req, res);

      expect(mockService.getCatalog).toHaveBeenCalledWith();
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toEqual({ providers: mockCatalog.asr });
    });
  });

  describe('getTtsProviders', () => {
    it('returns TTS providers with 200 status', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await (controller as any).getTtsProviders(req, res);

      expect(mockService.getCatalog).toHaveBeenCalledWith();
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toEqual({ providers: mockCatalog.tts });
    });
  });

  describe('getLlmProviders', () => {
    it('returns LLM providers with 200 status', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await (controller as any).getLlmProviders(req, res);

      expect(mockService.getCatalog).toHaveBeenCalledWith();
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toEqual({ providers: mockCatalog.llm });
    });
  });

  describe('getStorageProviders', () => {
    it('returns storage providers with 200 status', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await (controller as any).getStorageProviders(req, res);

      expect(mockService.getCatalog).toHaveBeenCalledWith();
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toEqual({ providers: mockCatalog.storage });
    });
  });

  describe('getModerationProviders', () => {
    it('returns moderation providers with 200 status', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await (controller as any).getModerationProviders(req, res);

      expect(mockService.getCatalog).toHaveBeenCalledWith();
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toEqual({ providers: mockCatalog.moderation });
    });
  });

  describe('getSpecificProvider', () => {
    it('returns specific ASR provider with 200 status', async () => {
      const req = createMockRequest({ params: { type: 'asr', apiType: 'azure' } });
      const res = createMockResponse();

      await (controller as any).getSpecificProvider(req, res);

      expect(mockService.getAsrProvider).toHaveBeenCalledWith('azure');
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toEqual(mockAsrProvider);
    });

    it('returns 404 for unknown provider', async () => {
      mockService.getAsrProvider.mockReturnValue(undefined);

      const req = createMockRequest({ params: { type: 'asr', apiType: 'nonexistent' } });
      const res = createMockResponse();

      await (controller as any).getSpecificProvider(req, res);

      expect((res as MockResponse).statusCode).toBe(404);
      expect((res as MockResponse).jsonBody).toEqual({
        error: 'Provider nonexistent not found for type asr',
      });
    });
  });

  describe('registerRoutes', () => {
    it('registers all provider catalog routes', () => {
      const mockRouter = { get: vi.fn() } as any;
      controller.registerRoutes(mockRouter);

      expect(mockRouter.get).toHaveBeenCalledWith('/api/provider-catalog', expect.any(Function));
      expect(mockRouter.get).toHaveBeenCalledWith('/api/provider-catalog/asr', expect.any(Function));
      expect(mockRouter.get).toHaveBeenCalledWith('/api/provider-catalog/tts', expect.any(Function));
      expect(mockRouter.get).toHaveBeenCalledWith('/api/provider-catalog/llm', expect.any(Function));
      expect(mockRouter.get).toHaveBeenCalledWith('/api/provider-catalog/storage', expect.any(Function));
      expect(mockRouter.get).toHaveBeenCalledWith('/api/provider-catalog/moderation', expect.any(Function));
      expect(mockRouter.get).toHaveBeenCalledWith('/api/provider-catalog/:type/:apiType', expect.any(Function));
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all routes', () => {
      const paths = ProviderCatalogController.getOpenAPIPaths();
      expect(paths).toHaveLength(7);
      expect(paths[0]).toMatchObject({
        method: 'get',
        path: '/api/provider-catalog',
        tags: ['Provider Catalog'],
      });
      expect(paths[1]).toMatchObject({
        method: 'get',
        path: '/api/provider-catalog/asr',
        tags: ['Provider Catalog'],
      });
      expect(paths[6]).toMatchObject({
        method: 'get',
        path: '/api/provider-catalog/{type}/{apiType}',
        tags: ['Provider Catalog'],
      });
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModerationConfig } from '../../../src/services/ModerationService';
import type { ILlmProvider } from '../../../src/services/providers/llm/ILlmProvider';

vi.mock('../../src/db/index', () => {
  const findFirst = vi.fn();
  return {
    db: {
      query: {
        providers: {
          findFirst,
        },
      },
    },
    __mocks: { findFirst },
  };
});

vi.mock('../../src/utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockProvider: ILlmProvider = {
  init: vi.fn().mockResolvedValue(undefined),
  generate: vi.fn(),
  generateStream: vi.fn(),
  setOnChunk: vi.fn(),
  setOnGenerationStarted: vi.fn(),
  setOnGenerationCompleted: vi.fn(),
  setOnError: vi.fn(),
  isInitialized: vi.fn().mockReturnValue(true),
  cleanup: vi.fn().mockResolvedValue(undefined),
  enumerateModels: vi.fn(),
  moderateUserInput: vi.fn(),
};

const mockFactory = {
  createProviderForEnumeration: vi.fn(),
};

vi.mock('../../src/services/providers/llm/LlmProviderFactory', () => ({
  LlmProviderFactory: vi.fn().mockImplementation(() => mockFactory),
}));

import { ModerationService } from '../../src/services/ModerationService';
import { __mocks as dbMock } from '../../src/db/index';

const testProjectId = 'proj_test001';

const createConfig = (overrides: Partial<ModerationConfig> = {}): ModerationConfig => ({
  enabled: true,
  llmProviderId: 'prov_test001',
  blockedCategories: undefined,
  ...overrides,
});

const createProviderEntity = () => ({
  id: 'prov_test001',
  projectId: testProjectId,
  name: 'Test Provider',
  providerType: 'llm',
  apiType: 'openai',
  config: { apiKey: 'test-key' },
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('ModerationService', () => {
  let service: ModerationService;

  beforeEach(() => {
    vi.clearAllMocks();
    (dbMock.findFirst as any).mockResolvedValue(createProviderEntity());
    mockFactory.createProviderForEnumeration.mockResolvedValue(mockProvider);
    service = new ModerationService(mockFactory as any);
  });

  describe('moderate with disabled/missing config', () => {
    it('returns non-flagged when config is null', async () => {
      const result = await service.moderate('test input', null, testProjectId);
      expect(result).toEqual({
        flagged: false,
        blockingCategories: [],
        detectedCategories: [],
        durationMs: 0,
        startMs: 0,
      });
    });

    it('returns non-flagged when config is undefined', async () => {
      const result = await service.moderate('test input', undefined, testProjectId);
      expect(result.flagged).toBe(false);
      expect(result.startMs).toBe(0);
    });

    it('returns non-flagged when enabled is false', async () => {
      const result = await service.moderate('test input', createConfig({ enabled: false }), testProjectId);
      expect(result.flagged).toBe(false);
      expect(result.durationMs).toBe(0);
    });

    it('does not query DB when moderation is disabled', async () => {
      await service.moderate('test input', createConfig({ enabled: false }), testProjectId);
      expect(dbMock.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('moderate with missing provider', () => {
    it('returns non-flagged when provider not found in DB', async () => {
      (dbMock.findFirst as any).mockResolvedValue(null);
      const result = await service.moderate('test input', createConfig(), testProjectId);
      expect(result.flagged).toBe(false);
      expect(result.durationMs).toBe(0);
      expect(result.startMs).toBe(0);
    });

    it('does not call factory when provider is missing', async () => {
      (dbMock.findFirst as any).mockResolvedValue(null);
      await service.moderate('test input', createConfig(), testProjectId);
      expect(mockFactory.createProviderForEnumeration).not.toHaveBeenCalled();
    });
  });

  describe('moderate with valid provider - unflagged content', () => {
    beforeEach(() => {
      (mockProvider.moderateUserInput as any).mockResolvedValue({ flagged: false, categories: [] });
    });

    it('returns non-flagged result for clean content', async () => {
      const result = await service.moderate('Hello, how are you?', createConfig(), testProjectId);
      expect(result.flagged).toBe(false);
      expect(result.blockingCategories).toEqual([]);
      expect(result.detectedCategories).toEqual([]);
    });

    it('passes input to provider moderateUserInput', async () => {
      await service.moderate('Hello, how are you?', createConfig(), testProjectId);
      expect(mockProvider.moderateUserInput).toHaveBeenCalledWith('Hello, how are you?');
    });

    it('records timing information', async () => {
      const result = await service.moderate('test', createConfig(), testProjectId);
      expect(result.startMs).toBeGreaterThan(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('initializes provider before moderation', async () => {
      await service.moderate('test', createConfig(), testProjectId);
      expect(mockProvider.init).toHaveBeenCalled();
    });
  });

  describe('moderate with flagged content', () => {
    it('returns flagged when provider flags content', async () => {
      (mockProvider.moderateUserInput as any).mockResolvedValue({
        flagged: true,
        categories: ['violence', 'hate'],
      });
      const result = await service.moderate('bad content', createConfig(), testProjectId);
      expect(result.flagged).toBe(true);
      expect(result.blockingCategories).toEqual(['violence', 'hate']);
      expect(result.detectedCategories).toEqual(['violence', 'hate']);
    });

    it('applies blockedCategories filter - only matching categories block', async () => {
      (mockProvider.moderateUserInput as any).mockResolvedValue({
        flagged: true,
        categories: ['violence', 'self_harm', 'sexual'],
      });
      const result = await service.moderate(
        'content',
        createConfig({ blockedCategories: ['violence'] }),
        testProjectId
      );
      expect(result.flagged).toBe(true);
      expect(result.blockingCategories).toEqual(['violence']);
      expect(result.detectedCategories).toEqual(['violence', 'self_harm', 'sexual']);
    });

    it('returns non-flagged when detected categories do not match blocklist', async () => {
      (mockProvider.moderateUserInput as any).mockResolvedValue({
        flagged: true,
        categories: ['sexual'],
      });
      const result = await service.moderate(
        'content',
        createConfig({ blockedCategories: ['violence', 'hate'] }),
        testProjectId
      );
      expect(result.flagged).toBe(false);
      expect(result.blockingCategories).toEqual([]);
    });

    it('blocks all categories when blockedCategories is empty array', async () => {
      (mockProvider.moderateUserInput as any).mockResolvedValue({
        flagged: true,
        categories: ['violence'],
      });
      const result = await service.moderate(
        'content',
        createConfig({ blockedCategories: [] }),
        testProjectId
      );
      expect(result.flagged).toBe(true);
      expect(result.blockingCategories).toEqual(['violence']);
    });

    it('blocks all categories when blockedCategories is undefined', async () => {
      (mockProvider.moderateUserInput as any).mockResolvedValue({
        flagged: true,
        categories: ['violence'],
      });
      const result = await service.moderate(
        'content',
        createConfig({ blockedCategories: undefined }),
        testProjectId
      );
      expect(result.flagged).toBe(true);
      expect(result.blockingCategories).toEqual(['violence']);
    });
  });

  describe('fail-open behavior', () => {
    it('returns non-flagged when provider throws generic error', async () => {
      (mockProvider.moderateUserInput as any).mockRejectedValue(new Error('Network timeout'));
      const result = await service.moderate('test input', createConfig(), testProjectId);
      expect(result.flagged).toBe(false);
      expect(result.blockingCategories).toEqual([]);
    });

    it('returns non-flagged when provider does not support moderation', async () => {
      (mockProvider.moderateUserInput as any).mockRejectedValue(
        new Error('Moderation is not supported by this model')
      );
      const result = await service.moderate('test input', createConfig(), testProjectId);
      expect(result.flagged).toBe(false);
    });

    it('still records timing on error path', async () => {
      (mockProvider.moderateUserInput as any).mockRejectedValue(new Error('fail'));
      const result = await service.moderate('test', createConfig(), testProjectId);
      expect(result.startMs).toBeGreaterThan(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('handles non-Error rejection', async () => {
      (mockProvider.moderateUserInput as any).mockRejectedValue('string error');
      const result = await service.moderate('test', createConfig(), testProjectId);
      expect(result.flagged).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles empty string input', async () => {
      (mockProvider.moderateUserInput as any).mockResolvedValue({ flagged: false, categories: [] });
      const result = await service.moderate('', createConfig(), testProjectId);
      expect(result.flagged).toBe(false);
      expect(mockProvider.moderateUserInput).toHaveBeenCalledWith('');
    });

    it('handles very long input', async () => {
      (mockProvider.moderateUserInput as any).mockResolvedValue({ flagged: false, categories: [] });
      const longInput = 'x'.repeat(10000);
      const result = await service.moderate(longInput, createConfig(), testProjectId);
      expect(result.flagged).toBe(false);
    });
  });
});

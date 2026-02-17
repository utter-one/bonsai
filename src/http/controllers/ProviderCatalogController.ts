import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { asyncHandler } from '../../utils/asyncHandler';
import { ProviderCatalogService } from '../../services/providers/ProviderCatalogService';
import { providerCatalogSchema, providerTypeParamSchema, specificProviderParamsSchema, asrProvidersResponseSchema, ttsProvidersResponseSchema, llmProvidersResponseSchema, storageProvidersResponseSchema, asrProviderInfoSchema, ttsProviderInfoSchema, llmProviderInfoSchema, storageProviderInfoSchema } from '../contracts/providerCatalog';

/**
 * Controller for provider catalog endpoints
 * Provides information about available provider types, models, and capabilities
 */
@singleton()
export class ProviderCatalogController {
  constructor(@inject(ProviderCatalogService) private readonly catalogService: ProviderCatalogService) {}

  /**
   * Returns OpenAPI path configurations for all provider catalog routes
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'get',
        path: '/api/provider-catalog',
        tags: ['Provider Catalog'],
        summary: 'Get complete provider catalog',
        description: 'Returns information about all available ASR, TTS, and LLM providers including their models, capabilities, and supported features',
        responses: {
          200: {
            description: 'Complete provider catalog with all provider types',
            content: {
              'application/json': {
                schema: providerCatalogSchema,
              },
            },
          },
        },
      },
      {
        method: 'get',
        path: '/api/provider-catalog/asr',
        tags: ['Provider Catalog'],
        summary: 'Get ASR providers',
        description: 'Returns information about all available ASR (Automatic Speech Recognition) providers including supported languages and capabilities',
        responses: {
          200: {
            description: 'List of ASR providers',
            content: {
              'application/json': {
                schema: asrProvidersResponseSchema,
              },
            },
          },
        },
      },
      {
        method: 'get',
        path: '/api/provider-catalog/tts',
        tags: ['Provider Catalog'],
        summary: 'Get TTS providers',
        description: 'Returns information about all available TTS (Text-to-Speech) providers including models, voices, and supported languages',
        responses: {
          200: {
            description: 'List of TTS providers',
            content: {
              'application/json': {
                schema: ttsProvidersResponseSchema,
              },
            },
          },
        },
      },
      {
        method: 'get',
        path: '/api/provider-catalog/llm',
        tags: ['Provider Catalog'],
        summary: 'Get LLM providers',
        description: 'Returns information about all available LLM (Large Language Model) providers including models, capabilities like tool calling, JSON output, and context windows',
        responses: {
          200: {
            description: 'List of LLM providers',
            content: {
              'application/json': {
                schema: llmProvidersResponseSchema,
              },
            },
          },
        },
      },
      {
        method: 'get',
        path: '/api/provider-catalog/storage',
        tags: ['Provider Catalog'],
        summary: 'Get storage providers',
        description: 'Returns information about all available storage providers including S3, Azure Blob, Google Cloud Storage, and local filesystem',
        responses: {
          200: {
            description: 'List of storage providers',
            content: {
              'application/json': {
                schema: storageProvidersResponseSchema,
              },
            },
          },
        },
      },
      {
        method: 'get',
        path: '/api/provider-catalog/{type}/{apiType}',
        tags: ['Provider Catalog'],
        summary: 'Get specific provider information',
        description: 'Returns detailed information about a specific provider by type and API type',
        request: {
          params: specificProviderParamsSchema,
        },
        responses: {
          200: {
            description: 'Specific provider information',
            content: {
              'application/json': {
                schema: asrProviderInfoSchema.or(ttsProviderInfoSchema).or(llmProviderInfoSchema).or(storageProviderInfoSchema),
              },
            },
          },
          404: {
            description: 'Provider not found',
          },
        },
      },
    ];
  }

  /**
   * Registers all provider catalog routes
   */
  registerRoutes(router: Router): void {
    router.get('/api/provider-catalog', asyncHandler(this.getCatalog.bind(this)));
    router.get('/api/provider-catalog/asr', asyncHandler(this.getAsrProviders.bind(this)));
    router.get('/api/provider-catalog/tts', asyncHandler(this.getTtsProviders.bind(this)));
    router.get('/api/provider-catalog/llm', asyncHandler(this.getLlmProviders.bind(this)));
    router.get('/api/provider-catalog/storage', asyncHandler(this.getStorageProviders.bind(this)));
    router.get('/api/provider-catalog/:type/:apiType', asyncHandler(this.getSpecificProvider.bind(this)));
  }

  /**
   * GET /api/provider-catalog
   * Returns the complete provider catalog with all provider types
   */
  private async getCatalog(req: Request, res: Response): Promise<void> {
    const catalog = this.catalogService.getCatalog();
    res.status(200).json(catalog);
  }

  /**
   * GET /api/provider-catalog/asr
   * Returns all ASR providers
   */
  private async getAsrProviders(req: Request, res: Response): Promise<void> {
    const catalog = this.catalogService.getCatalog();
    res.status(200).json({ providers: catalog.asr });
  }

  /**
   * GET /api/provider-catalog/tts
   * Returns all TTS providers
   */
  private async getTtsProviders(req: Request, res: Response): Promise<void> {
    const catalog = this.catalogService.getCatalog();
    res.status(200).json({ providers: catalog.tts });
  }

  /**
   * GET /api/provider-catalog/llm
   * Returns all LLM providers
   */
  private async getLlmProviders(req: Request, res: Response): Promise<void> {
    const catalog = this.catalogService.getCatalog();
    res.status(200).json({ providers: catalog.llm });
  }

  /**
   * GET /api/provider-catalog/storage
   * Returns all storage providers
   */
  private async getStorageProviders(req: Request, res: Response): Promise<void> {
    const catalog = this.catalogService.getCatalog();
    res.status(200).json({ providers: catalog.storage });
  }

  /**
   * GET /api/provider-catalog/:type/:apiType
   * Returns information about a specific provider
   */
  private async getSpecificProvider(req: Request, res: Response): Promise<void> {
    const params = specificProviderParamsSchema.parse(req.params);

    let provider;
    switch (params.type) {
      case 'asr':
        provider = this.catalogService.getAsrProvider(params.apiType);
        break;
      case 'tts':
        provider = this.catalogService.getTtsProvider(params.apiType);
        break;
      case 'llm':
        provider = this.catalogService.getLlmProvider(params.apiType);
        break;
      case 'storage':
        provider = this.catalogService.getStorageProvider(params.apiType);
        break;
    }

    if (!provider) {
      res.status(404).json({ error: `Provider ${params.apiType} not found for type ${params.type}` });
      return;
    }

    res.status(200).json(provider);
  }
}

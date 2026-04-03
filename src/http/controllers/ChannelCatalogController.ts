import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { asyncHandler } from '../../utils/asyncHandler';
import { ChannelCatalog } from '../../channels/ChannelCatalog';
import { channelCatalogResponseSchema, channelInfoSchema, channelTypeParamSchema, type ChannelInfo } from '../contracts/channelCatalog';
import type { ICommunicationChannel } from '../../channels/IChannelDescriptor';

/**
 * Controller exposing the channel catalog via REST.
 *
 * Endpoints:
 * - `GET /api/channel-catalog` — list all supported channels with their capabilities
 * - `GET /api/channel-catalog/:type` — get a single channel by type
 */
@singleton()
export class ChannelCatalogController {
  constructor(@inject(ChannelCatalog) private readonly catalog: ChannelCatalog) {}

  /**
   * Returns OpenAPI path configurations for all channel catalog routes.
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'get',
        path: '/api/channel-catalog',
        tags: ['Channel Catalog'],
        summary: 'List all supported channels',
        description: 'Returns all communication channel types supported by this backend instance, including their capabilities and supported audio formats.',
        responses: {
          200: {
            description: 'List of supported channels',
            content: {
              'application/json': {
                schema: channelCatalogResponseSchema,
              },
            },
          },
        },
      },
      {
        method: 'get',
        path: '/api/channel-catalog/{type}',
        tags: ['Channel Catalog'],
        summary: 'Get a channel by type',
        description: 'Returns details and capabilities for a single channel type.',
        request: {
          params: channelTypeParamSchema,
        },
        responses: {
          200: {
            description: 'Channel details',
            content: {
              'application/json': {
                schema: channelInfoSchema,
              },
            },
          },
          404: { description: 'Channel type not found' },
        },
      },
    ];
  }

  /**
   * Registers routes on the provided Express router.
   * @param router - The Express application or router to attach routes to.
   */
  registerRoutes(router: Router): void {
    router.get('/api/channel-catalog', asyncHandler(this.listChannels.bind(this)));
    router.get('/api/channel-catalog/:type', asyncHandler(this.getChannel.bind(this)));
  }

  private async listChannels(_req: Request, res: Response): Promise<void> {
    const channels = this.catalog.getChannels().map(toChannelInfo);
    res.status(200).json(channelCatalogResponseSchema.parse({ channels }));
  }

  private async getChannel(req: Request, res: Response): Promise<void> {
    const { type } = channelTypeParamSchema.parse(req.params);
    const channel = this.catalog.getChannel(type);
    res.status(200).json(channelInfoSchema.parse(toChannelInfo(channel)));
  }
}

/** Maps an ICommunicationChannel instance to its API response shape. */
function toChannelInfo(channel: ICommunicationChannel): ChannelInfo {
  return {
    type: channel.getType(),
    name: channel.getName(),
    capabilities: channel.getCapabilities(),
  };
}

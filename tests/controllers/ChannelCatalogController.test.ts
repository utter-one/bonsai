import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse } from '../helpers/controllerTestUtils';
import type { MockResponse } from '../helpers/controllerTestUtils';

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ChannelCatalogController } from '../../src/http/controllers/ChannelCatalogController';
import type { ICommunicationChannel, ChannelCapabilities } from '../../src/channels/IChannelDescriptor';

describe('ChannelCatalogController', () => {
  let controller: ChannelCatalogController;
  let mockCatalog: any;

  const mockCapabilities: ChannelCapabilities = {
    supportsVoiceInput: true,
    supportsTextInput: true,
    supportsVoiceOutput: true,
    supportsTextOutput: true,
    supportsCommands: false,
    supportsEvents: true,
    supportsIncomingConnections: true,
    supportsOutgoingConnections: false,
  };

  const createMockChannel = (type: string, name: string): ICommunicationChannel => ({
    getType: vi.fn().mockReturnValue(type),
    getName: vi.fn().mockReturnValue(name),
    getCapabilities: vi.fn().mockReturnValue(mockCapabilities),
    getConfigSchema: vi.fn().mockReturnValue({} as any),
  });

  beforeEach(() => {
    vi.clearAllMocks();

    const mockChannels = [
      createMockChannel('websocket', 'WebSocket'),
      createMockChannel('webrtc', 'WebRTC'),
    ];

    mockCatalog = {
      getChannels: vi.fn().mockReturnValue(mockChannels),
      getChannel: vi.fn().mockImplementation((type: string) => mockChannels.find((c) => c.getType() === type)),
    };

    controller = new ChannelCatalogController(mockCatalog);
  });

  describe('listChannels', () => {
    it('returns channel catalog with 200 status', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await (controller as any).listChannels(req, res);

      expect(mockCatalog.getChannels).toHaveBeenCalledWith();
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toEqual({
        channels: [
          { type: 'websocket', name: 'WebSocket', capabilities: mockCapabilities },
          { type: 'webrtc', name: 'WebRTC', capabilities: mockCapabilities },
        ],
      });
    });

    it('does not require authentication', async () => {
      const req = createMockRequest({ user: undefined });
      const res = createMockResponse();

      await expect((controller as any).listChannels(req, res)).resolves.not.toThrow();
      expect((res as MockResponse).statusCode).toBe(200);
    });

    it('returns empty channels array when catalog is empty', async () => {
      mockCatalog.getChannels.mockReturnValue([]);
      const req = createMockRequest();
      const res = createMockResponse();

      await (controller as any).listChannels(req, res);

      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toEqual({ channels: [] });
    });
  });

  describe('getChannel', () => {
    it('returns single channel info with 200 status', async () => {
      const req = createMockRequest({ params: { type: 'websocket' } });
      const res = createMockResponse();

      await (controller as any).getChannel(req, res);

      expect(mockCatalog.getChannel).toHaveBeenCalledWith('websocket');
      expect((res as MockResponse).statusCode).toBe(200);
      expect((res as MockResponse).jsonBody).toEqual({
        type: 'websocket',
        name: 'WebSocket',
        capabilities: mockCapabilities,
      });
    });

    it('throws error for unsupported channel type', async () => {
      mockCatalog.getChannel.mockImplementation(() => {
        throw new Error('Unsupported channel type: invalid');
      });

      const req = createMockRequest({ params: { type: 'invalid' } });
      const res = createMockResponse();

      await expect((controller as any).getChannel(req, res)).rejects.toThrow(
        'Unsupported channel type: invalid',
      );
    });
  });

  describe('registerRoutes', () => {
    it('registers the /api/channel-catalog route', () => {
      const mockRouter = { get: vi.fn() } as any;
      controller.registerRoutes(mockRouter);
      expect(mockRouter.get).toHaveBeenCalledWith(
        '/api/channel-catalog',
        expect.any(Function),
      );
    });

    it('registers the /api/channel-catalog/:type route', () => {
      const mockRouter = { get: vi.fn() } as any;
      controller.registerRoutes(mockRouter);
      expect(mockRouter.get).toHaveBeenCalledWith(
        '/api/channel-catalog/:type',
        expect.any(Function),
      );
    });
  });

  describe('getOpenAPIPaths', () => {
    it('returns OpenAPI path definitions for all routes', () => {
      const paths = ChannelCatalogController.getOpenAPIPaths();
      expect(paths).toHaveLength(2);
      expect(paths[0]).toMatchObject({
        method: 'get',
        path: '/api/channel-catalog',
        tags: ['Channel Catalog'],
      });
      expect(paths[1]).toMatchObject({
        method: 'get',
        path: '/api/channel-catalog/{type}',
        tags: ['Channel Catalog'],
      });
    });
  });
});

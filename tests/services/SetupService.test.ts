import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InvalidOperationError } from '../../src/errors';

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/db/index', () => {
  const findMany = vi.fn().mockResolvedValue([]);
  const mocks = { lastInsertedValues: {} as Record<string, any> };
  const insertMock = vi.fn().mockReturnValue({
    values: vi.fn().mockImplementation((v: Record<string, any>) => {
      Object.assign(mocks.lastInsertedValues, v);
      return {
        returning: vi.fn().mockResolvedValue([{
          ...v,
          createdAt: new Date(),
          updatedAt: new Date(),
        }]),
      };
    }),
  });

  const operatorsTable = {
    findMany,
  };

  return {
    db: {
      query: { operators: operatorsTable },
      insert: insertMock,
    },
    __mocks: { findMany, ...mocks },
  };
});

import { SetupService } from '../../src/services/SetupService';
import { __mocks as dbMock } from '../../src/db/index';

describe('SetupService', () => {
  let service: SetupService;
  let mockAuthService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthService = {
      hashPassword: vi.fn().mockResolvedValue('hashed_password_123'),
      login: vi.fn().mockResolvedValue({
        accessToken: 'access_token_abc',
        refreshToken: 'refresh_token_xyz',
        expiresIn: 900,
      }),
    };
    service = new SetupService(mockAuthService);
    dbMock.findMany.mockResolvedValue([]);
  });

  describe('getSetupStatus', () => {
    it('returns isSetup: false when no operators exist', async () => {
      const result = await service.getSetupStatus();
      expect(result.isSetup).toBe(false);
      expect(result.message).toContain('setup required');
    });

    it('returns isSetup: true when operators exist', async () => {
      dbMock.findMany.mockResolvedValue([{ id: 'op_test123' }]);
      const result = await service.getSetupStatus();
      expect(result.isSetup).toBe(true);
      expect(result.message).toContain('already configured');
    });
  });

  describe('createInitialOperator', () => {
    it('creates the initial operator with super_admin role', async () => {
      const input = {
        id: 'op_initial001',
        name: 'Initial Admin',
        password: 'strongpassword123',
      };
      const result = await service.createInitialOperator(input);
      expect(result.operator.id).toBe('op_initial001');
      expect(result.operator.name).toBe('Initial Admin');
      expect(result.operator.roles).toEqual(['super_admin']);
      expect(result.accessToken).toBe('access_token_abc');
      expect(result.refreshToken).toBe('refresh_token_xyz');
      expect(result.expiresIn).toBe(900);
    });

    it('hashes the password before storing', async () => {
      await service.createInitialOperator({
        id: 'op_initial001',
        name: 'Admin',
        password: 'plaintext',
      });
      expect(mockAuthService.hashPassword).toHaveBeenCalledWith('plaintext');
      expect(dbMock.lastInsertedValues.password).toBe('hashed_password_123');
    });

    it('calls authService.login with correct credentials', async () => {
      await service.createInitialOperator({
        id: 'op_initial001',
        name: 'Admin',
        password: 'mypass',
      });
      expect(mockAuthService.login).toHaveBeenCalledWith('op_initial001', 'mypass');
    });

    it('throws InvalidOperationError when system is already set up', async () => {
      dbMock.findMany.mockResolvedValue([{ id: 'op_existing' }]);
      await expect(
        service.createInitialOperator({ id: 'op_new', name: 'New', password: 'pass' })
      ).rejects.toThrow(InvalidOperationError);
    });

    it('accepts optional metadata', async () => {
      const input = {
        id: 'op_initial001',
        name: 'Admin',
        password: 'pass',
        metadata: { department: 'engineering' },
      };
      const result = await service.createInitialOperator(input);
      expect(result.operator.metadata).toEqual({ department: 'engineering' });
    });

    it('defaults metadata to empty object when not provided', async () => {
      const result = await service.createInitialOperator({
        id: 'op_initial001',
        name: 'Admin',
        password: 'pass',
      });
      expect(result.operator.metadata).toEqual({});
    });
  });
});

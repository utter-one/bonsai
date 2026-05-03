import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JWTPayload } from '../../src/http/middleware/auth';
import { UnauthorizedError } from '../../src/errors';

vi.mock('bcrypt', () => {
  const hash = vi.fn();
  const compare = vi.fn();
  return {
    default: { hash, compare },
    __mocks: { hash, compare },
  };
});

vi.mock('jsonwebtoken', () => {
  const sign = vi.fn();
  const verify = vi.fn();
  const JsonWebTokenError = class MockJwtError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'JsonWebTokenError';
    }
  };
  const TokenExpiredError = class MockExpiredError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'TokenExpiredError';
    }
  };
  return {
    default: { sign, verify, JsonWebTokenError, TokenExpiredError },
    sign,
    verify,
    JsonWebTokenError,
    TokenExpiredError,
    __mocks: { sign, verify },
  };
});

vi.mock('../../src/db/index', () => {
  const findFirst = vi.fn();
  return {
    db: {
      query: {
        operators: {
          findFirst,
        },
      },
    },
    __mocks: { findFirst },
  };
});

vi.mock('../../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import * as bcryptMod from 'bcrypt';
import jwt from 'jsonwebtoken';
import { AuthService } from '../../src/services/AuthService';
import { __mocks as dbMocks } from '../../src/db/index';

const mockBcryptHash = (bcryptMod as any).__mocks.hash;
const mockBcryptCompare = (bcryptMod as any).__mocks.compare;
const JwtMod = jwt as any;
const JsonWebTokenError = JwtMod.default ? JwtMod.default.JsonWebTokenError : JwtMod.JsonWebTokenError;
const TokenExpiredError = JwtMod.default ? JwtMod.default.TokenExpiredError : JwtMod.TokenExpiredError;

const mockJwtSign = JwtMod.sign;
const mockJwtVerify = JwtMod.verify;
const mockOperatorsFindFirst = dbMocks.findFirst;

const createOperator = (overrides: Partial<any> = {}) => ({
  id: 'oper_test001',
  name: 'Test Operator',
  email: 'test@example.com',
  password: '$2b$10$hashedpassword',
  roles: ['content_manager'],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret-min-32-chars-long';
    mockBcryptHash.mockResolvedValue('$2b$10$hashedpassword');
    mockBcryptCompare.mockResolvedValue(true);
    mockJwtSign.mockImplementation((payload: JWTPayload) => `jwt-${payload.type}-token`);
    mockJwtVerify.mockImplementation((_token: string) => ({
      operatorId: 'oper_test001',
      roles: ['content_manager'],
      type: 'access',
    }));
    mockOperatorsFindFirst.mockResolvedValue(createOperator());
    service = new AuthService();
  });

  describe('hashPassword', () => {
    it('calls bcrypt.hash with correct salt rounds', async () => {
      await service.hashPassword('my-password');
      expect(mockBcryptHash).toHaveBeenCalledWith('my-password', 10);
    });

    it('returns the bcrypt hash result', async () => {
      mockBcryptHash.mockResolvedValue('$2b$10$resulthash');
      const result = await service.hashPassword('password');
      expect(result).toBe('$2b$10$resulthash');
    });
  });

  describe('verifyPassword', () => {
    it('returns true for correct password', async () => {
      mockBcryptCompare.mockResolvedValue(true);
      const result = await service.verifyPassword('correct', '$2b$10$hash');
      expect(result).toBe(true);
    });

    it('returns false for incorrect password', async () => {
      mockBcryptCompare.mockResolvedValue(false);
      const result = await service.verifyPassword('wrong', '$2b$10$hash');
      expect(result).toBe(false);
    });

    it('calls bcrypt.compare with correct arguments', async () => {
      await service.verifyPassword('pass', 'hash-value');
      expect(mockBcryptCompare).toHaveBeenCalledWith('pass', 'hash-value');
    });
  });

  describe('login', () => {
    it('returns login response with tokens on valid credentials', async () => {
      const result = await service.login('oper_test001', 'correct-password');
      expect(result.accessToken).toBe('jwt-access-token');
      expect(result.refreshToken).toBe('jwt-refresh-token');
      expect(result.operatorId).toBe('oper_test001');
      expect(result.name).toBe('Test Operator');
      expect(result.roles).toEqual(['content_manager']);
      expect(result.permissions.length).toBeGreaterThan(0);
    });

    it('generates access token with correct payload and expiry', async () => {
      await service.login('oper_test001', 'password');
      expect(mockJwtSign).toHaveBeenCalledWith(
        { operatorId: 'oper_test001', roles: ['content_manager'], type: 'access' },
        'test-secret-min-32-chars-long',
        { expiresIn: '18h' }
      );
    });

    it('generates refresh token with correct payload and expiry', async () => {
      await service.login('oper_test001', 'password');
      expect(mockJwtSign).toHaveBeenCalledWith(
        { operatorId: 'oper_test001', roles: ['content_manager'], type: 'refresh' },
        'test-secret-min-32-chars-long',
        { expiresIn: '14d' }
      );
    });

    it('throws UnauthorizedError when operator not found', async () => {
      mockOperatorsFindFirst.mockResolvedValue(null);
      await expect(service.login('nonexistent', 'password')).rejects.toThrow(UnauthorizedError);
    });

    it('throws UnauthorizedError when password is wrong', async () => {
      mockBcryptCompare.mockResolvedValue(false);
      await expect(service.login('oper_test001', 'wrong-password')).rejects.toThrow(UnauthorizedError);
    });

    it('throws UnauthorizedError for DB errors (fail-safe)', async () => {
      mockOperatorsFindFirst.mockRejectedValue(new Error('DB connection failed'));
      await expect(service.login('oper_test001', 'password')).rejects.toThrow(UnauthorizedError);
    });

    it('includes expiresIn as seconds in response', async () => {
      const result = await service.login('oper_test001', 'password');
      expect(result.expiresIn).toBe(18 * 3600);
    });

    it('throws UnauthorizedError when JWT_SECRET is not set (fail-safe)', async () => {
      delete process.env.JWT_SECRET;
      mockOperatorsFindFirst.mockResolvedValue(createOperator());
      await expect(service.login('oper_test001', 'password')).rejects.toThrow(UnauthorizedError);
      process.env.JWT_SECRET = 'test-secret-min-32-chars-long';
    });
  });

  describe('refresh', () => {
    beforeEach(() => {
      mockJwtVerify.mockImplementation((_token: string) => ({
        operatorId: 'oper_test001',
        roles: ['content_manager'],
        type: 'refresh',
      }));
    });

    it('returns new access token on valid refresh', async () => {
      const result = await service.refresh('valid-refresh-token');
      expect(result.accessToken).toBe('jwt-access-token');
      expect(result.expiresIn).toBe(18 * 3600);
      expect(result.roles).toEqual(['content_manager']);
      expect(result.permissions.length).toBeGreaterThan(0);
    });

    it('rejects non-refresh token type', async () => {
      mockJwtVerify.mockReturnValue({
        operatorId: 'oper_test001',
        roles: ['content_manager'],
        type: 'access',
      });
      await expect(service.refresh('access-token-as-refresh')).rejects.toThrow(UnauthorizedError);
    });

    it('rejects expired refresh token', async () => {
      mockJwtVerify.mockImplementation(() => {
        throw new TokenExpiredError('expired');
      });
      await expect(service.refresh('expired-token')).rejects.toThrow(UnauthorizedError);
    });

    it('rejects malformed token', async () => {
      mockJwtVerify.mockImplementation(() => {
        throw new JsonWebTokenError('invalid');
      });
      await expect(service.refresh('malformed-token')).rejects.toThrow(UnauthorizedError);
    });

    it('rejects when operator no longer exists', async () => {
      mockOperatorsFindFirst.mockResolvedValue(null);
      await expect(service.refresh('valid-refresh-token')).rejects.toThrow(UnauthorizedError);
    });

    it('throws UnauthorizedError when JWT_SECRET is not set (fail-safe)', async () => {
      delete process.env.JWT_SECRET;
      await expect(service.refresh('token')).rejects.toThrow(UnauthorizedError);
      process.env.JWT_SECRET = 'test-secret-min-32-chars-long';
    });

    it('returns updated roles if operator roles changed', async () => {
      mockJwtVerify.mockReturnValue({
        operatorId: 'oper_test001',
        roles: ['viewer'],
        type: 'refresh',
      });
      const updatedOperator = createOperator({ roles: ['super_admin'] });
      mockOperatorsFindFirst.mockResolvedValue(updatedOperator);
      const result = await service.refresh('old-token');
      expect(result.roles).toEqual(['super_admin']);
    });
  });

  describe('jwtTimeToSeconds (private, tested via login/refresh)', () => {
    it('converts 18h to 64800 seconds', async () => {
      const result = await service.login('oper_test001', 'password');
      expect(result.expiresIn).toBe(64800);
    });
  });

  describe('RBAC permissions', () => {
    it('super_admin gets all permissions', async () => {
      const superAdmin = createOperator({ roles: ['super_admin'] });
      mockOperatorsFindFirst.mockResolvedValue(superAdmin);
      const result = await service.login('oper_test001', 'password');
      expect(result.permissions.length).toBeGreaterThan(50);
    });

    it('viewer gets read-only permissions', async () => {
      const viewer = createOperator({ roles: ['viewer'] });
      mockOperatorsFindFirst.mockResolvedValue(viewer);
      const result = await service.login('oper_test001', 'password');
      for (const perm of result.permissions) {
        expect(perm.endsWith(':read')).toBe(true);
      }
    });

    it('unknown role returns empty permissions', async () => {
      const unknownRole = createOperator({ roles: ['nonexistent_role'] });
      mockOperatorsFindFirst.mockResolvedValue(unknownRole);
      const result = await service.login('oper_test001', 'password');
      expect(result.permissions).toEqual([]);
    });

    it('multiple roles combine permissions', async () => {
      const multiRole = createOperator({ roles: ['viewer', 'support'] });
      mockOperatorsFindFirst.mockResolvedValue(multiRole);
      const result = await service.login('oper_test001', 'password');
      expect(result.permissions.length).toBeGreaterThan(20);
    });
  });
});

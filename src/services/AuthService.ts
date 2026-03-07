import { injectable } from 'tsyringe';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { operators } from '../db/schema';
import type { JWTPayload } from '../http/middleware/auth';
import { UnauthorizedError, InvalidOperationError } from '../errors';
import { logger } from '../utils/logger';

/** Access token expiry time (18 hours) */
const ACCESS_TOKEN_EXPIRY = '18h';

/** Refresh token expiry time (14 days) */
const REFRESH_TOKEN_EXPIRY = '14d';

/** Salt rounds for bcrypt password hashing */
const BCRYPT_SALT_ROUNDS = 10;

/**
 * Login response containing access and refresh tokens
 */
export type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  operatorId: string;
  name: string;
  roles: string[];
};

/**
 * Refresh response containing new access token
 */
export type RefreshResponse = {
  accessToken: string;
  expiresIn: number;
};

/**
 * Service for authentication and JWT token management
 */
@injectable()
export class AuthService {
  /**
   * Hash a password using bcrypt
   * @param password - Plain text password
   * @returns Hashed password
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  }

  /**
   * Verify a password against its hash
   * @param password - Plain text password
   * @param hash - Hashed password
   * @returns True if password matches
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generate a JWT token
   * @param payload - Token payload
   * @param expiresIn - Token expiry time
   * @returns Signed JWT token
   */
  private generateToken(payload: JWTPayload, expiresIn: string): string {
    if (!process.env.JWT_SECRET) {
      throw new InvalidOperationError('JWT_SECRET not configured');
    }

    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: expiresIn as any });
  }

  /**
   * Authenticate an operator user with email and password
   * @param id - Operator user ID (email)
   * @param password - Plain text password
   * @returns Login response with tokens and user info
   * @throws {UnauthorizedError} When credentials are invalid
   */
  async login(id: string, password: string): Promise<LoginResponse> {
    logger.info({ operatorId: id }, 'Login attempt');

    try {
      const operator = await db.query.operators.findFirst({ where: eq(operators.id, id) });

      if (!operator) {
        logger.warn({ operatorId: id }, 'Login failed: operator not found');
        throw new UnauthorizedError('Invalid credentials');
      }

      const isValidPassword = await this.verifyPassword(password, operator.password);

      if (!isValidPassword) {
        logger.warn({ operatorId: id }, 'Login failed: invalid password');
        throw new UnauthorizedError('Invalid credentials');
      }

      const payload: Omit<JWTPayload, 'type'> = {
        operatorId: operator.id,
        roles: operator.roles,
      };

      const accessToken = this.generateToken({ ...payload, type: 'access' }, ACCESS_TOKEN_EXPIRY);
      const refreshToken = this.generateToken({ ...payload, type: 'refresh' }, REFRESH_TOKEN_EXPIRY);

      logger.info({ operatorId: operator.id, roles: operator.roles }, 'Login successful');

      return {
        accessToken,
        refreshToken,
        expiresIn: this.jwtTimeToSeconds(ACCESS_TOKEN_EXPIRY),
        operatorId: operator.id,
        name: operator.name,
        roles: operator.roles,
      };
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        throw error;
      }
      logger.error({ error, operatorId: id }, 'Login failed');
      throw new UnauthorizedError('Authentication failed');
    }
  }

  /**
   * Refresh an access token using a refresh token
   * @param refreshToken - Valid refresh token
   * @returns New access token
   * @throws {UnauthorizedError} When refresh token is invalid
   */
  async refresh(refreshToken: string): Promise<RefreshResponse> {
    logger.debug('Token refresh attempt');

    try {
      if (!process.env.JWT_SECRET) {
        throw new InvalidOperationError('JWT_SECRET not configured');
      }

      const payload = jwt.verify(refreshToken, process.env.JWT_SECRET) as JWTPayload;

      if (payload.type !== 'refresh') {
        logger.warn({ tokenType: payload.type }, 'Invalid token type for refresh');
        throw new UnauthorizedError('Invalid refresh token');
      }

      const operator = await db.query.operators.findFirst({ where: eq(operators.id, payload.operatorId) });

      if (!operator) {
        logger.warn({ operatorId: payload.operatorId }, 'Refresh failed: operator not found');
        throw new UnauthorizedError('Invalid refresh token');
      }

      const newAccessToken = this.generateToken({ operatorId: operator.id, roles: operator.roles, type: 'access' }, ACCESS_TOKEN_EXPIRY);

      logger.info({ operatorId: operator.id }, 'Token refreshed successfully');

      return {
        accessToken: newAccessToken,
        expiresIn: this.jwtTimeToSeconds(ACCESS_TOKEN_EXPIRY),
      };
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        logger.warn({ error: error.message }, 'Refresh failed: invalid token');
        throw new UnauthorizedError('Invalid refresh token');
      }
      if (error instanceof jwt.TokenExpiredError) {
        logger.warn('Refresh failed: token expired');
        throw new UnauthorizedError('Refresh token expired');
      }
      if (error instanceof UnauthorizedError) {
        throw error;
      }
      logger.error({ error }, 'Refresh failed');
      throw new UnauthorizedError('Token refresh failed');
    }
  }

  private jwtTimeToSeconds(time: string): number {
    const match = time.match(/^(\d+)([smhd])$/);
    if (!match) {
      throw new InvalidOperationError(`Invalid time format: ${time}`);
    }
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 3600;
      case 'd':
        return value * 86400;
      default:
        throw new InvalidOperationError(`Unsupported time unit: ${unit}`);
    }
  }
}

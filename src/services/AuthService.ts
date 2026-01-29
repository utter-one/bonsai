import { injectable } from 'tsyringe';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { admins } from '../db/schema';
import type { JWTPayload } from '../http/middleware/auth';
import { UnauthorizedError, InvalidOperationError } from '../errors';
import { logger } from '../utils/logger';

/** Access token expiry time (15 minutes) */
const ACCESS_TOKEN_EXPIRY = '15m';

/** Refresh token expiry time (7 days) */
const REFRESH_TOKEN_EXPIRY = '7d';

/** Salt rounds for bcrypt password hashing */
const BCRYPT_SALT_ROUNDS = 10;

/**
 * Login response containing access and refresh tokens
 */
export type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  adminId: string;
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
   * Authenticate an admin user with email and password
   * @param id - Admin user ID (email)
   * @param password - Plain text password
   * @returns Login response with tokens and user info
   * @throws {UnauthorizedError} When credentials are invalid
   */
  async login(id: string, password: string): Promise<LoginResponse> {
    logger.info({ adminId: id }, 'Login attempt');

    try {
      const admin = await db.query.admins.findFirst({ where: eq(admins.id, id) });

      if (!admin) {
        logger.warn({ adminId: id }, 'Login failed: admin not found');
        throw new UnauthorizedError('Invalid credentials');
      }

      const isValidPassword = await this.verifyPassword(password, admin.password);

      if (!isValidPassword) {
        logger.warn({ adminId: id }, 'Login failed: invalid password');
        throw new UnauthorizedError('Invalid credentials');
      }

      const payload: Omit<JWTPayload, 'type'> = {
        adminId: admin.id,
        roles: admin.roles,
      };

      const accessToken = this.generateToken({ ...payload, type: 'access' }, ACCESS_TOKEN_EXPIRY);
      const refreshToken = this.generateToken({ ...payload, type: 'refresh' }, REFRESH_TOKEN_EXPIRY);

      logger.info({ adminId: admin.id, roles: admin.roles }, 'Login successful');

      return {
        accessToken,
        refreshToken,
        expiresIn: 900, // 15 minutes in seconds
        adminId: admin.id,
        name: admin.name,
        roles: admin.roles,
      };
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        throw error;
      }
      logger.error({ error, adminId: id }, 'Login failed');
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

      const admin = await db.query.admins.findFirst({ where: eq(admins.id, payload.adminId) });

      if (!admin) {
        logger.warn({ adminId: payload.adminId }, 'Refresh failed: admin not found');
        throw new UnauthorizedError('Invalid refresh token');
      }

      const newAccessToken = this.generateToken({ adminId: admin.id, roles: admin.roles, type: 'access' }, ACCESS_TOKEN_EXPIRY);

      logger.info({ adminId: admin.id }, 'Token refreshed successfully');

      return {
        accessToken: newAccessToken,
        expiresIn: 900, // 15 minutes in seconds
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
}

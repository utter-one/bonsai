import { injectable, inject } from 'tsyringe';
import { db } from '../db/index';
import { admins } from '../db/schema';
import type { InitialAdminSetupRequest, InitialAdminSetupResponse, SetupStatusResponse } from '../api/setup';
import { AuthService } from './AuthService';
import { InvalidOperationError } from '../errors';
import { logger } from '../utils/logger';
import { ROLES } from '../permissions';

/**
 * Service for system setup and initialization
 * Handles first-time configuration when no admin accounts exist
 */
@injectable()
export class SetupService {
  constructor(@inject(AuthService) private readonly authService: AuthService) {}

  /**
   * Check if the system has been set up (i.e., at least one admin exists)
   * @returns Setup status with boolean flag and descriptive message
   */
  async getSetupStatus(): Promise<SetupStatusResponse> {
    logger.debug('Checking system setup status');

    try {
      const adminCount = await db.query.admins.findMany({ limit: 1 });

      const isSetup = adminCount.length > 0;

      logger.debug({ isSetup, adminCount: adminCount.length }, 'System setup status checked');

      return {
        isSetup,
        message: isSetup ? 'System is already configured with admin accounts' : 'System setup required - no admin accounts found',
      };
    } catch (error) {
      logger.error({ error }, 'Failed to check system setup status');
      throw error;
    }
  }

  /**
   * Create the initial admin account with super_admin role
   * This endpoint can only be used when no admin accounts exist
   * @param input - Initial admin creation data (id, displayName, password, optional metadata)
   * @returns Admin details and authentication tokens for immediate login
   */
  async createInitialAdmin(input: InitialAdminSetupRequest): Promise<InitialAdminSetupResponse> {
    logger.info({ adminId: input.id, displayName: input.displayName }, 'Creating initial admin account');

    try {
      // Check if any admin accounts exist
      const existingAdmins = await db.query.admins.findMany({ limit: 1 });

      if (existingAdmins.length > 0) {
        logger.warn({ adminId: input.id, existingAdminCount: existingAdmins.length }, 'Attempted initial admin creation when system is already set up');
        throw new InvalidOperationError('System is already configured. Use regular admin creation endpoint instead.');
      }

      // Hash password before storing
      const hashedPassword = await this.authService.hashPassword(input.password);

      // Create admin with super_admin role (all permissions)
      const admin = await db.insert(admins).values({ id: input.id, displayName: input.displayName, roles: ['super_admin'], password: hashedPassword, metadata: input.metadata, version: 1 }).returning();

      const createdAdmin = admin[0];

      // Generate authentication tokens for immediate login
      const loginResponse = await this.authService.login(input.id, input.password);

      logger.info({ adminId: createdAdmin.id, roles: createdAdmin.roles }, 'Initial admin account created successfully');

      return {
        admin: {
          id: createdAdmin.id,
          displayName: createdAdmin.displayName,
          roles: createdAdmin.roles,
          metadata: createdAdmin.metadata ?? undefined,
          createdAt: createdAdmin.createdAt,
        },
        accessToken: loginResponse.accessToken,
        refreshToken: loginResponse.refreshToken,
        expiresIn: loginResponse.expiresIn,
      };
    } catch (error) {
      if (error instanceof InvalidOperationError) {
        throw error;
      }
      logger.error({ error, adminId: input.id }, 'Failed to create initial admin');
      throw error;
    }
  }
}

import { injectable, inject } from 'tsyringe';
import { count } from 'drizzle-orm';
import { db } from '../db/index';
import { operators } from '../db/schema';
import type { InitialOperatorSetupRequest, InitialOperatorSetupResponse, SetupStatusResponse } from '../http/contracts/setup';
import { AuthService } from './AuthService';
import { InvalidOperationError } from '../errors';
import { logger } from '../utils/logger';

/**
 * Service for system setup and initialization
 * Handles first-time configuration when no operator accounts exist
 */
@injectable()
export class SetupService {
  constructor(@inject(AuthService) private readonly authService: AuthService) {}

  /**
   * Check if the system has been set up (i.e., at least one operator exists)
   * @returns Setup status with boolean flag and descriptive message
   */
  async getSetupStatus(): Promise<SetupStatusResponse> {
    logger.debug('Checking system setup status');

    try {
      const [{ count: operatorCount }] = await db.select({ count: count() }).from(operators);

      const isSetup = operatorCount > 0;

      logger.debug({ isSetup, operatorCount }, 'System setup status checked');

      return {
        isSetup,
        message: isSetup ? 'System is already configured with operator accounts' : 'System setup required - no operator accounts found',
      };
    } catch (error) {
      logger.error({ error }, 'Failed to check system setup status');
      throw error;
    }
  }

  /**
   * Create the initial operator account with super_admin role
   * This endpoint can only be used when no operator accounts exist
   * @param input - Initial operator creation data (id, name, password, optional metadata)
   * @returns Operator details and authentication tokens for immediate login
   */
  async createInitialOperator(input: InitialOperatorSetupRequest): Promise<InitialOperatorSetupResponse> {
    logger.info({ operatorId: input.id, name: input.name }, 'Creating initial operator account');

    // Hash password outside the transaction to avoid holding a transaction for crypto work
    const hashedPassword = await this.authService.hashPassword(input.password);

    try {
      let createdOperator: typeof operators.$inferSelect;

      await db.transaction(
        async (tx) => {
          const [{ count: operatorCount }] = await tx.select({ count: count() }).from(operators);

          if (operatorCount > 0) {
            logger.warn({ operatorId: input.id }, 'Attempted initial operator creation when system is already set up');
            throw new InvalidOperationError('System is already configured. Use regular operator creation endpoint instead.');
          }

          const operator = await tx.insert(operators).values({ id: input.id, name: input.name, roles: ['super_admin'], password: hashedPassword, metadata: input.metadata ?? {}, version: 1 }).returning();

          createdOperator = operator[0];
        },
        { isolationLevel: 'serializable' },
      );

      // Generate authentication tokens for immediate login (outside transaction)
      const loginResponse = await this.authService.login(input.id, input.password);

      logger.info({ operatorId: createdOperator.id, roles: createdOperator.roles }, 'Initial operator account created successfully');

      return {
        operator: {
          id: createdOperator.id,
          name: createdOperator.name,
          roles: createdOperator.roles,
          metadata: createdOperator.metadata ?? {},
          createdAt: createdOperator.createdAt,
        },
        accessToken: loginResponse.accessToken,
        refreshToken: loginResponse.refreshToken,
        expiresIn: loginResponse.expiresIn,
      };
    } catch (error) {
      if (error instanceof InvalidOperationError) {
        throw error;
      }
      logger.error({ error, operatorId: input.id }, 'Failed to create initial operator');
      throw error;
    }
  }
}

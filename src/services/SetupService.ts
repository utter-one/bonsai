import { injectable, inject } from 'tsyringe';
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
      const operatorCount = await db.query.operators.findMany({ limit: 1 });

      const isSetup = operatorCount.length > 0;

      logger.debug({ isSetup, operatorCount: operatorCount.length }, 'System setup status checked');

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

    try {
      // Check if any operator accounts exist
      const existingOperators = await db.query.operators.findMany({ limit: 1 });

      if (existingOperators.length > 0) {
        logger.warn({ operatorId: input.id, existingOperatorCount: existingOperators.length }, 'Attempted initial operator creation when system is already set up');
        throw new InvalidOperationError('System is already configured. Use regular operator creation endpoint instead.');
      }

      // Hash password before storing
      const hashedPassword = await this.authService.hashPassword(input.password);

      // Create operator with super_admin role (all permissions)
      const operator = await db.insert(operators).values({ id: input.id, name: input.name, roles: ['super_admin'], password: hashedPassword, metadata: input.metadata ?? {}, version: 1 }).returning();

      const createdOperator = operator[0];

      // Generate authentication tokens for immediate login
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

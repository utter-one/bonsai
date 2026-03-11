import { injectable, inject } from 'tsyringe';
import { eq, ilike, or, and, SQL, desc, sql } from 'drizzle-orm';
import { parseTextSearch } from '../utils/textSearch';
import { db } from '../db/index';
import { operators } from '../db/schema';
import type { CreateOperatorRequest, UpdateOperatorRequest, OperatorResponse, OperatorListResponse, UpdateProfileRequest, ProfileResponse } from '../http/contracts/operator';
import type { ListParams } from '../http/contracts/common';
import { operatorResponseSchema, operatorListResponseSchema, profileResponseSchema } from '../http/contracts/operator';
import { AuditService } from './AuditService';
import { AuthService } from './AuthService';
import { OptimisticLockError, NotFoundError, InvalidOperationError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { countRows, normalizeListLimit } from '../utils/pagination';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS, ROLES } from '../permissions';

/**
 * Service for managing operator users with full CRUD operations and audit logging
 */
@injectable()
export class OperatorService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService, @inject(AuthService) private readonly authService: AuthService) {
    super();
  }

  /**
   * Creates a new operator user and logs the creation in the audit trail
   * @param input - Operator creation data including id, name, roles, password, and optional metadata
   * @param context - Request context for auditing and authorization
   * @returns The created operator user (without password)
   */
  async createOperator(input: CreateOperatorRequest, context: RequestContext): Promise<OperatorResponse> {
    this.requirePermission(context, PERMISSIONS.OPERATOR_WRITE);
    const operatorId = input.id;
    if (!operatorId) {
      throw new InvalidOperationError('Operator ID (email) must be provided when creating an operator');
    }

    logger.info({ operatorId, name: input.name, roles: input.roles, contextOperatorId: context?.operatorId }, 'Creating operator');

    try {
      // Validate roles exist in ROLES definition
      this.validateRoles(input.roles);

      // Remove duplicate roles
      const distinctRoles = Array.from(new Set(input.roles));

      // Hash password before storing
      const hashedPassword = await this.authService.hashPassword(input.password);

      const operator = await db.insert(operators).values({ id: input.id, name: input.name, roles: distinctRoles, password: hashedPassword, metadata: input.metadata, version: 1 }).returning();

      const createdOperator = operator[0];

      const { password: _pw, ...safeCreatedOperator } = createdOperator;
      await this.auditService.logCreate('operator', createdOperator.id, safeCreatedOperator, context?.operatorId);

      logger.info({ operatorId: createdOperator.id }, 'Operator created successfully');

      return operatorResponseSchema.parse(createdOperator);
    } catch (error) {
      logger.error({ error, operatorId: input.id }, 'Failed to create operator');
      throw error;
    }
  }

  /**
   * Retrieves an operator user by their unique identifier
   * @param id - The unique identifier of the operator user
   * @returns The operator user if found (without password)
   * @throws {NotFoundError} When operator is not found
   */
  async getOperatorById(id: string): Promise<OperatorResponse> {
    logger.debug({ operatorId: id }, 'Fetching operator by ID');

    try {
      const operator = await db.query.operators.findFirst({ where: eq(operators.id, id) });

      if (!operator) {
        throw new NotFoundError(`Operator with id ${id} not found`);
      }

      return operatorResponseSchema.parse(operator);
    } catch (error) {
      logger.error({ error, operatorId: id }, 'Failed to fetch operator');
      throw error;
    }
  }

  /**
   * Lists operator users with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of operator users matching the criteria (without passwords)
   */
  async listOperators(params?: ListParams): Promise<OperatorListResponse> {
    logger.debug({ params }, 'Listing operators');

    try {
      const conditions: SQL[] = [];
      const offset = params?.offset ?? 0;
      const limit = normalizeListLimit(params?.limit);

      // Column map for filter and order by operations
      const columnMap = {
        id: operators.id,
        name: operators.name,
        version: operators.version,
        createdAt: operators.createdAt,
        updatedAt: operators.updatedAt,
      };

      // Apply filters
      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          if (field === 'roles') {
            const rolesArray = Array.isArray(filter) ? filter as string[] : [filter as string];
            conditions.push(sql`${operators.roles} @> ${JSON.stringify(rolesArray)}::jsonb`);
            continue;
          }
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      // Apply text search: ilike on id (email) and name; for "tag:" prefix use JSONB containment on roles
      if (params?.textSearch) {
        const parsed = parseTextSearch(params.textSearch);
        if (parsed.type === 'tag') {
          conditions.push(sql`${operators.roles} @> ${JSON.stringify([parsed.value])}::jsonb`);
        } else {
          const searchTerm = `%${parsed.value}%`;
          conditions.push(or(ilike(operators.id, searchTerm), ilike(operators.name, searchTerm), sql`${operators.roles}::text ilike ${searchTerm}`)!);
        }
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

      const total = await countRows(operators, whereCondition);

      // Get paginated results
      const operatorList = await db.query.operators.findMany({
        where: whereCondition,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(operators.createdAt)],
        limit,
        offset,
      });

      return operatorListResponseSchema.parse({
        items: operatorList,
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list operators');
      throw error;
    }
  }

  /**
   * Updates an operator user using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the operator user to update
   * @param input - Operator update data (with version)
   * @param context - Request context for auditing and authorization
   * @returns The updated operator user (without password)
   * @throws {NotFoundError} When operator is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateOperator(id: string, input: UpdateOperatorRequest, context: RequestContext): Promise<OperatorResponse> {
    this.requirePermission(context, PERMISSIONS.OPERATOR_WRITE);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ operatorId: id, expectedVersion, contextOperatorId: context?.operatorId }, 'Updating operator');

    try {
      const existingOperator = await db.query.operators.findFirst({ where: eq(operators.id, id) });

      if (!existingOperator) {
        throw new NotFoundError(`Operator with id ${id} not found`);
      }

      if (existingOperator.version !== expectedVersion) {
        throw new OptimisticLockError(`Operator version mismatch. Expected ${expectedVersion}, got ${existingOperator.version}`);
      }

      // Validate roles if being updated
      if (updateData.roles) {
        this.validateRoles(updateData.roles);
      }

      // Hash password if it's being updated
      const updatePayload: any = {
        name: updateData.name,
        roles: updateData.roles ? Array.from(new Set(updateData.roles)) : undefined,
        metadata: updateData.metadata,
        version: existingOperator.version + 1,
        updatedAt: new Date(),
      };

      if (updateData.password) {
        updatePayload.password = await this.authService.hashPassword(updateData.password);
      }

      const updatedOperator = await db.update(operators).set(updatePayload).where(and(eq(operators.id, id), eq(operators.version, expectedVersion))).returning();

      if (updatedOperator.length === 0) {
        throw new OptimisticLockError(`Failed to update operator due to version conflict`);
      }

      const operator = updatedOperator[0];

      const { password: _oldPw, ...safeExistingOperator } = existingOperator;
      const { password: _newPw, ...safeOperator } = operator;
      await this.auditService.logUpdate('operator', operator.id, safeExistingOperator, safeOperator, context?.operatorId);

      logger.info({ operatorId: operator.id, newVersion: operator.version }, 'Operator updated successfully');

      return operatorResponseSchema.parse(operator);
    } catch (error) {
      logger.error({ error, operatorId: id }, 'Failed to update operator');
      throw error;
    }
  }

  /**
   * Deletes an operator user using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the operator user to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deleteOperator(id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.OPERATOR_DELETE);
    logger.info({ operatorId: id, expectedVersion, contextOperatorId: context?.operatorId }, 'Deleting operator');

    try {
      const existingOperator = await db.query.operators.findFirst({ where: eq(operators.id, id) });

      if (!existingOperator) {
        throw new NotFoundError(`Operator with id ${id} not found`);
      }

      if (existingOperator.version !== expectedVersion) {
        throw new OptimisticLockError(`Operator version mismatch. Expected ${expectedVersion}, got ${existingOperator.version}`);
      }

      const deleted = await db.delete(operators).where(and(eq(operators.id, id), eq(operators.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete operator due to version conflict`);
      }

      const { password: _pw, ...safeExistingOperator } = existingOperator;
      await this.auditService.logDelete('operator', id, safeExistingOperator, context?.operatorId);

      logger.info({ operatorId: id }, 'Operator deleted successfully');
    } catch (error) {
      logger.error({ error, operatorId: id }, 'Failed to delete operator');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific operator user
   * @param operatorId - The unique identifier of the operator user
   * @returns Array of audit log entries for the operator user
   */
  async getOperatorAuditLogs(operatorId: string): Promise<any[]> {
    logger.debug({ operatorId }, 'Fetching audit logs for operator');

    try {
      return await this.auditService.getEntityAuditLogs('operator', operatorId);
    } catch (error) {
      logger.error({ error, operatorId }, 'Failed to fetch operator audit logs');
      throw error;
    }
  }

  /**
   * Validates that all provided roles exist in the ROLES definition
   * @param roles - Array of role names to validate
   * @throws {Error} When any role is invalid
   */
  private validateRoles(roles: string[]): void {
    const validRoles = Object.keys(ROLES);
    const invalidRoles = roles.filter(role => !(role in ROLES));

    if (invalidRoles.length > 0) {
      throw new Error(`Invalid roles: ${invalidRoles.join(', ')}. Valid roles are: ${validRoles.join(', ')}`);
    }
  }

  /**
   * Retrieves the profile of the currently logged-in operator user
   * @param context - Request context containing the authenticated operator ID
   * @returns The profile information of the logged-in operator
   * @throws {NotFoundError} When operator is not found
   */
  async getProfile(context: RequestContext): Promise<ProfileResponse> {
    logger.debug({ operatorId: context.operatorId }, 'Fetching profile for logged-in operator');

    try {
      const operator = await db.query.operators.findFirst({ where: eq(operators.id, context.operatorId) });

      if (!operator) {
        throw new NotFoundError(`Operator with id ${context.operatorId} not found`);
      }

      return profileResponseSchema.parse(operator);
    } catch (error) {
      logger.error({ error, operatorId: context.operatorId }, 'Failed to fetch profile');
      throw error;
    }
  }

  /**
   * Updates the profile of the currently logged-in operator user
   * Allows changing display name and/or password
   * When changing password, the old password must be verified first
   * @param input - Profile update data including name, oldPassword, and newPassword
   * @param context - Request context containing the authenticated operator ID
   * @returns The updated profile information
   * @throws {NotFoundError} When operator is not found
   * @throws {Error} When old password is invalid
   */
  async updateProfile(input: UpdateProfileRequest, context: RequestContext): Promise<ProfileResponse> {
    logger.info({ operatorId: context.operatorId }, 'Updating profile for logged-in operator');

    try {
      const existingOperator = await db.query.operators.findFirst({ where: eq(operators.id, context.operatorId) });

      if (!existingOperator) {
        throw new NotFoundError(`Operator with id ${context.operatorId} not found`);
      }

      // Verify old password if changing password
      if (input.newPassword) {
        if (!input.oldPassword) {
          throw new Error('Old password is required when changing password');
        }

        const isValidPassword = await this.authService.verifyPassword(input.oldPassword, existingOperator.password);
        if (!isValidPassword) {
          throw new Error('Invalid old password');
        }
      }

      // Build update data
      const updateData: any = {
        version: existingOperator.version + 1,
        updatedAt: new Date(),
      };

      if (input.name) {
        updateData.name = input.name;
      }

      if (input.newPassword) {
        updateData.password = await this.authService.hashPassword(input.newPassword);
      }

      const updatedOperator = await db.update(operators).set(updateData).where(eq(operators.id, context.operatorId)).returning();

      if (updatedOperator.length === 0) {
        throw new Error('Failed to update profile');
      }

      const operator = updatedOperator[0];

      // Log the update for audit purposes
      const { password: _oldPw, ...safeExistingOperator } = existingOperator;
      const { password: _newPw, ...safeOperator } = operator;
      const oldEntity = input.newPassword ? { ...safeExistingOperator, passwordChanged: false } : safeExistingOperator;
      const newEntity = input.newPassword ? { ...safeOperator, passwordChanged: true } : safeOperator;

      await this.auditService.logUpdate('operator', operator.id, oldEntity, newEntity, context.operatorId);

      logger.info({ operatorId: operator.id, newVersion: operator.version }, 'Profile updated successfully');

      return profileResponseSchema.parse(operator);
    } catch (error) {
      logger.error({ error, operatorId: context.operatorId }, 'Failed to update profile');
      throw error;
    }
  }
}

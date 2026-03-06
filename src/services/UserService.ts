import { injectable, inject } from 'tsyringe';
import { eq, or, and, like, SQL, desc, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { users } from '../db/schema';
import type { CreateUserRequest, UpdateUserRequest, UserResponse, UserListResponse } from '../http/contracts/user';
import type { ListParams } from '../http/contracts/common';
import { userResponseSchema, userListResponseSchema } from '../http/contracts/user';
import { AuditService } from './AuditService';
import { NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';

/**
 * Service for managing users with full CRUD operations and audit logging
 */
@injectable()
export class UserService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Creates a new user scoped to a project
   * @param projectId - The project this user belongs to
   * @param input - User creation data including id and profile
   * @param context - Request context for auditing and authorization
   * @returns The created user
   */
  async createUser(projectId: string, input: CreateUserRequest, context: RequestContext): Promise<UserResponse> {
    this.requirePermission(context, PERMISSIONS.USER_WRITE);
    await this.requireProjectNotArchived(projectId);
    const userId = input.id ?? generateId(ID_PREFIXES.USER);
    logger.info({ userId, projectId, operatorId: context?.operatorId }, 'Creating user');

    try {
      const user = await db.insert(users).values({ id: userId, projectId, profile: input.profile }).returning();

      const createdUser = user[0];

      await this.auditService.logCreate('user', createdUser.id, { id: createdUser.id, projectId: createdUser.projectId, profile: createdUser.profile }, context?.operatorId);

      logger.info({ userId: createdUser.id, projectId }, 'User created successfully');

      return userResponseSchema.parse(createdUser);
    } catch (error) {
      logger.error({ error, userId: input.id, projectId }, 'Failed to create user');
      throw error;
    }
  }

  /**
   * Retrieves a user by their project-scoped identifier
   * @param projectId - The project the user belongs to
   * @param id - The unique identifier of the user
   * @returns The user if found
   * @throws {NotFoundError} When user is not found
   */
  async getUserById(projectId: string, id: string): Promise<UserResponse> {
    logger.debug({ userId: id, projectId }, 'Fetching user by ID');

    try {
      const user = await db.query.users.findFirst({ where: and(eq(users.projectId, projectId), eq(users.id, id)) });

      if (!user) {
        throw new NotFoundError(`User with id ${id} not found in project ${projectId}`);
      }

      const archived = !(await this.isProjectActive(projectId));
      return userResponseSchema.parse({ ...user, archived });
    } catch (error) {
      logger.error({ error, userId: id, projectId }, 'Failed to fetch user');
      throw error;
    }
  }

  /**
   * Lists users for a project with flexible filtering, sorting, and pagination
   * @param projectId - The project to list users for
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of users matching the criteria
   */
  async listUsers(projectId: string, params?: ListParams): Promise<UserListResponse> {
    logger.debug({ projectId, params }, 'Listing users');

    try {
      const conditions: SQL[] = [eq(users.projectId, projectId)];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      // Column map for filter and order by operations
      const columnMap = {
        id: users.id,
        projectId: users.projectId,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      };

      // Apply filters
      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      // Apply text search (searches profile.name via JSONB extraction)
      if (params?.textSearch) {
        const searchTerm = `%${params.textSearch}%`;
        conditions.push(or(like(users.id, searchTerm), sql`(${users.profile}->>'name') ilike ${searchTerm}`));
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      // Get total count
      const totalResult = await db.query.users.findMany({
        where: and(...conditions),
      });
      const total = totalResult.length;

      // Get paginated results
      const userList = await db.query.users.findMany({
        where: and(...conditions),
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(users.createdAt)],
        limit: limit ?? undefined,
        offset,
      });

      const archived = !(await this.isProjectActive(projectId));
      return userListResponseSchema.parse({
        items: userList.map(u => ({ ...u, archived })),
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, projectId, params }, 'Failed to list users');
      throw error;
    }
  }

  /**
   * Updates a user within a project
   * @param projectId - The project the user belongs to
   * @param id - The unique identifier of the user to update
   * @param input - User update data including profile
   * @param context - Request context for auditing and authorization
   * @returns The updated user
   * @throws {NotFoundError} When user is not found
   */
  async updateUser(projectId: string, id: string, input: UpdateUserRequest, context: RequestContext): Promise<UserResponse> {
    this.requirePermission(context, PERMISSIONS.USER_WRITE);
    await this.requireProjectNotArchived(projectId);
    logger.info({ userId: id, projectId, operatorId: context?.operatorId }, 'Updating user');

    try {
      const existingUser = await db.query.users.findFirst({ where: and(eq(users.projectId, projectId), eq(users.id, id)) });

      if (!existingUser) {
        throw new NotFoundError(`User with id ${id} not found in project ${projectId}`);
      }

      const updatedUser = await db.update(users).set({ profile: input.profile, updatedAt: new Date() }).where(and(eq(users.projectId, projectId), eq(users.id, id))).returning();

      if (updatedUser.length === 0) {
        throw new NotFoundError(`User with id ${id} not found in project ${projectId}`);
      }

      const user = updatedUser[0];

      await this.auditService.logUpdate('user', user.id, { id: existingUser.id, projectId: existingUser.projectId, profile: existingUser.profile }, { id: user.id, projectId: user.projectId, profile: user.profile }, context?.operatorId);

      logger.info({ userId: user.id, projectId }, 'User updated successfully');

      return userResponseSchema.parse(user);
    } catch (error) {
      logger.error({ error, userId: id, projectId }, 'Failed to update user');
      throw error;
    }
  }

  /**
   * Deletes a user within a project
   * @param projectId - The project the user belongs to
   * @param id - The unique identifier of the user to delete
   * @param context - Request context for auditing and authorization
   */
  async deleteUser(projectId: string, id: string, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.USER_DELETE);
    await this.requireProjectNotArchived(projectId);
    logger.info({ userId: id, projectId, operatorId: context?.operatorId }, 'Deleting user');

    try {
      const existingUser = await db.query.users.findFirst({ where: and(eq(users.projectId, projectId), eq(users.id, id)) });

      if (!existingUser) {
        throw new NotFoundError(`User with id ${id} not found in project ${projectId}`);
      }

      const deleted = await db.delete(users).where(and(eq(users.projectId, projectId), eq(users.id, id))).returning();

      if (deleted.length === 0) {
        throw new NotFoundError(`User with id ${id} not found in project ${projectId}`);
      }

      await this.auditService.logDelete('user', id, { id: existingUser.id, profile: existingUser.profile }, context?.operatorId);

      logger.info({ userId: id }, 'User deleted successfully');
    } catch (error) {
      logger.error({ error, userId: id }, 'Failed to delete user');
      throw error;
    }
  }

  /**
   * Ensures a user exists within a project, creating them with an empty profile if they do not.
   * This is used internally when a project has autoCreateUsers enabled to allow clients to
   * provide arbitrary user IDs that are automatically registered on first use.
   * @param projectId - The project the user belongs to
   * @param userId - The ID of the user to ensure exists
   * @returns The existing or newly created user
   */
  async ensureUserExists(projectId: string, userId: string): Promise<UserResponse> {
    logger.info({ userId, projectId }, 'Ensuring user exists (auto-create)');

    try {
      const existing = await db.query.users.findFirst({ where: and(eq(users.projectId, projectId), eq(users.id, userId)) });

      if (existing) {
        return userResponseSchema.parse(existing);
      }

      const created = await db.insert(users).values({ id: userId, projectId, profile: {} }).returning();
      const createdUser = created[0];

      logger.info({ userId: createdUser.id, projectId }, 'User auto-created successfully');

      return userResponseSchema.parse(createdUser);
    } catch (error) {
      logger.error({ error, userId, projectId }, 'Failed to ensure user exists');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific user
   * @param userId - The unique identifier of the user
   * @returns Array of audit log entries for the user
   */
  async getUserAuditLogs(userId: string): Promise<any[]> {
    logger.debug({ userId }, 'Fetching audit logs for user');

    try {
      return await this.auditService.getEntityAuditLogs('user', userId);
    } catch (error) {
      logger.error({ error, userId }, 'Failed to fetch user audit logs');
      throw error;
    }
  }
}

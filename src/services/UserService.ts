import { injectable, inject } from 'tsyringe';
import type { Logger } from 'pino';
import { eq, and, like, SQL, desc } from 'drizzle-orm';
import { db } from '../db/index';
import { users } from '../db/schema';
import type { CreateUserRequest, UpdateUserRequest, UserResponse, UserListResponse } from '../api/user';
import type { ListParams } from '../api/common';
import { userResponseSchema, userListResponseSchema } from '../api/user';
import { AuditService } from './AuditService';
import { NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';

/**
 * Service for managing users with full CRUD operations and audit logging
 */
@injectable()
export class UserService {
  constructor(@inject('Logger') private readonly logger: Logger, @inject(AuditService) private readonly auditService: AuditService) {}

  /**
   * Creates a new user and logs the creation in the audit trail
   * @param input - User creation data including id and profile
   * @param adminId - Optional ID of the admin performing the action for audit purposes
   * @returns The created user
   */
  async createUser(input: CreateUserRequest, adminId?: string): Promise<UserResponse> {
    this.logger.info({ userId: input.id, adminId }, 'Creating user');

    try {
      const user = await db.insert(users).values({ id: input.id, profile: input.profile }).returning();

      const createdUser = user[0];

      await this.auditService.logCreate('user', createdUser.id, { id: createdUser.id, profile: createdUser.profile }, adminId);

      this.logger.info({ userId: createdUser.id }, 'User created successfully');

      return userResponseSchema.parse(createdUser);
    } catch (error) {
      this.logger.error({ error, userId: input.id }, 'Failed to create user');
      throw error;
    }
  }

  /**
   * Retrieves a user by their unique identifier
   * @param id - The unique identifier of the user
   * @returns The user if found
   * @throws {NotFoundError} When user is not found
   */
  async getUserById(id: string): Promise<UserResponse> {
    this.logger.debug({ userId: id }, 'Fetching user by ID');

    try {
      const user = await db.query.users.findFirst({ where: eq(users.id, id) });

      if (!user) {
        throw new NotFoundError(`User with id ${id} not found`);
      }

      return userResponseSchema.parse(user);
    } catch (error) {
      this.logger.error({ error, userId: id }, 'Failed to fetch user');
      throw error;
    }
  }

  /**
   * Lists users with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of users matching the criteria
   */
  async listUsers(params?: ListParams): Promise<UserListResponse> {
    this.logger.debug({ params }, 'Listing users');

    try {
      const conditions: SQL[] = [];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      // Column map for filter and order by operations
      const columnMap = {
        id: users.id,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      };

      // Apply filters
      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          const condition = buildFilterCondition(field, filter, columnMap, this.logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      // Apply text search (searches id only for users)
      if (params?.textSearch) {
        const searchTerm = `%${params.textSearch}%`;
        conditions.push(like(users.id, searchTerm));
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      // Get total count
      const totalResult = await db.query.users.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
      });
      const total = totalResult.length;

      // Get paginated results
      const userList = await db.query.users.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(users.createdAt)],
        limit: limit ?? undefined,
        offset,
      });

      return userListResponseSchema.parse({
        items: userList,
        total,
        offset,
        limit,
      });
    } catch (error) {
      this.logger.error({ error, params }, 'Failed to list users');
      throw error;
    }
  }

  /**
   * Updates a user
   * @param id - The unique identifier of the user to update
   * @param input - User update data including profile
   * @param adminId - Optional ID of the admin performing the action for audit purposes
   * @returns The updated user
   * @throws {NotFoundError} When user is not found
   */
  async updateUser(id: string, input: UpdateUserRequest, adminId?: string): Promise<UserResponse> {
    this.logger.info({ userId: id, adminId }, 'Updating user');

    try {
      const existingUser = await db.query.users.findFirst({ where: eq(users.id, id) });

      if (!existingUser) {
        throw new NotFoundError(`User with id ${id} not found`);
      }

      const updatedUser = await db.update(users).set({ profile: input.profile, updatedAt: new Date() }).where(eq(users.id, id)).returning();

      if (updatedUser.length === 0) {
        throw new NotFoundError(`User with id ${id} not found`);
      }

      const user = updatedUser[0];

      await this.auditService.logUpdate('user', user.id, { id: existingUser.id, profile: existingUser.profile }, { id: user.id, profile: user.profile }, adminId);

      this.logger.info({ userId: user.id }, 'User updated successfully');

      return userResponseSchema.parse(user);
    } catch (error) {
      this.logger.error({ error, userId: id }, 'Failed to update user');
      throw error;
    }
  }

  /**
   * Deletes a user
   * @param id - The unique identifier of the user to delete
   * @param adminId - Optional ID of the admin performing the action for audit purposes
   */
  async deleteUser(id: string, adminId?: string): Promise<void> {
    this.logger.info({ userId: id, adminId }, 'Deleting user');

    try {
      const existingUser = await db.query.users.findFirst({ where: eq(users.id, id) });

      if (!existingUser) {
        throw new NotFoundError(`User with id ${id} not found`);
      }

      const deleted = await db.delete(users).where(eq(users.id, id)).returning();

      if (deleted.length === 0) {
        throw new NotFoundError(`User with id ${id} not found`);
      }

      await this.auditService.logDelete('user', id, { id: existingUser.id, profile: existingUser.profile }, adminId);

      this.logger.info({ userId: id }, 'User deleted successfully');
    } catch (error) {
      this.logger.error({ error, userId: id }, 'Failed to delete user');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific user
   * @param userId - The unique identifier of the user
   * @returns Array of audit log entries for the user
   */
  async getUserAuditLogs(userId: string): Promise<any[]> {
    this.logger.debug({ userId }, 'Fetching audit logs for user');

    try {
      return await this.auditService.getEntityAuditLogs('user', userId);
    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to fetch user audit logs');
      throw error;
    }
  }
}

import { injectable, inject } from 'tsyringe';
import type { Logger } from 'pino';
import { eq, and, gte, lte, like, SQL, desc } from 'drizzle-orm';
import { db } from '../db/index';
import { admins } from '../db/schema';
import type { CreateAdminRequest, UpdateAdminRequest, AdminResponse, AdminListResponse } from '../api/admin';
import type { ListParams } from '../api/common';
import { adminResponseSchema, adminListResponseSchema } from '../api/admin';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';

/**
 * Service for managing admin users with full CRUD operations and audit logging
 */
@injectable()
export class AdminService {
  constructor(@inject('Logger') private readonly logger: Logger, @inject(AuditService) private readonly auditService: AuditService) {}

  /**
   * Creates a new admin user and logs the creation in the audit trail
   * @param input - Admin creation data including id, displayName, roles, password, and optional metadata
   * @param userId - Optional ID of the user performing the action for audit purposes
   * @returns The created admin user (without password)
   */
  async createAdmin(input: CreateAdminRequest, userId?: string): Promise<AdminResponse> {
    this.logger.info({ adminId: input.id, displayName: input.displayName, roles: input.roles, userId }, 'Creating admin');

    try {
      const admin = await db.insert(admins).values({ id: input.id, displayName: input.displayName, roles: input.roles, password: input.password, metadata: input.metadata, version: 1 }).returning();

      const createdAdmin = admin[0];

      await this.auditService.logCreate('admin', createdAdmin.id, { id: createdAdmin.id, displayName: createdAdmin.displayName, roles: createdAdmin.roles, metadata: createdAdmin.metadata }, userId);

      this.logger.info({ adminId: createdAdmin.id }, 'Admin created successfully');

      return adminResponseSchema.parse(createdAdmin);
    } catch (error) {
      this.logger.error({ error, adminId: input.id }, 'Failed to create admin');
      throw error;
    }
  }

  /**
   * Retrieves an admin user by their unique identifier
   * @param id - The unique identifier of the admin user
   * @returns The admin user if found (without password)
   * @throws {NotFoundError} When admin is not found
   */
  async getAdminById(id: string): Promise<AdminResponse> {
    this.logger.debug({ adminId: id }, 'Fetching admin by ID');

    try {
      const admin = await db.query.admins.findFirst({ where: eq(admins.id, id) });

      if (!admin) {
        throw new NotFoundError(`Admin with id ${id} not found`);
      }

      return adminResponseSchema.parse(admin);
    } catch (error) {
      this.logger.error({ error, adminId: id }, 'Failed to fetch admin');
      throw error;
    }
  }

  /**
   * Lists admin users with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of admin users matching the criteria (without passwords)
   */
  async listAdmins(params?: ListParams): Promise<AdminListResponse> {
    this.logger.debug({ params }, 'Listing admins');

    try {
      const conditions: SQL[] = [];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      // Column map for filter and order by operations
      const columnMap = {
        id: admins.id,
        displayName: admins.displayName,
        version: admins.version,
        createdAt: admins.createdAt,
        updatedAt: admins.updatedAt,
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

      // Apply text search (searches displayName and id)
      if (params?.textSearch) {
        const searchTerm = `%${params.textSearch}%`;
        conditions.push(like(admins.displayName, searchTerm));
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      // Get total count
      const totalResult = await db.query.admins.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
      });
      const total = totalResult.length;

      // Get paginated results
      const adminList = await db.query.admins.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(admins.createdAt)],
        limit: limit ?? undefined,
        offset,
      });

      // Filter by roles if needed (array contains check not supported in SQL easily)
      let filteredList = adminList;
      if (params?.filters?.roles) {
        const rolesFilter = params.filters.roles;
        let roleValues: string[] = [];
        
        if (Array.isArray(rolesFilter)) {
          roleValues = rolesFilter as string[];
        } else if (typeof rolesFilter === 'object' && 'value' in rolesFilter && Array.isArray(rolesFilter.value)) {
          roleValues = rolesFilter.value as string[];
        }
        
        if (roleValues.length > 0) {
          filteredList = adminList.filter(admin => admin.roles.some(role => roleValues.includes(role)));
        }
      }

      return adminListResponseSchema.parse({
        items: filteredList,
        total,
        offset,
        limit,
      });
    } catch (error) {
      this.logger.error({ error, params }, 'Failed to list admins');
      throw error;
    }
  }

  /**
   * Updates an admin user using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the admin user to update
   * @param input - Admin update data including displayName, roles, password, and metadata (without version)
   * @param expectedVersion - The expected version number for optimistic locking
   * @param userId - Optional ID of the user performing the action for audit purposes
   * @returns The updated admin user (without password)
   * @throws {NotFoundError} When admin is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateAdmin(id: string, input: Omit<UpdateAdminRequest, 'version'>, expectedVersion: number, userId?: string): Promise<AdminResponse> {
    this.logger.info({ adminId: id, expectedVersion, userId }, 'Updating admin');

    try {
      const existingAdmin = await db.query.admins.findFirst({ where: eq(admins.id, id) });

      if (!existingAdmin) {
        throw new NotFoundError(`Admin with id ${id} not found`);
      }

      if (existingAdmin.version !== expectedVersion) {
        throw new OptimisticLockError(`Admin version mismatch. Expected ${expectedVersion}, got ${existingAdmin.version}`);
      }

      const updatedAdmin = await db.update(admins).set({ displayName: input.displayName, roles: input.roles, password: input.password, metadata: input.metadata, version: existingAdmin.version + 1, updatedAt: new Date() }).where(and(eq(admins.id, id), eq(admins.version, expectedVersion))).returning();

      if (updatedAdmin.length === 0) {
        throw new OptimisticLockError(`Failed to update admin due to version conflict`);
      }

      const admin = updatedAdmin[0];

      await this.auditService.logUpdate('admin', admin.id, { id: existingAdmin.id, displayName: existingAdmin.displayName, roles: existingAdmin.roles, metadata: existingAdmin.metadata }, { id: admin.id, displayName: admin.displayName, roles: admin.roles, metadata: admin.metadata }, userId);

      this.logger.info({ adminId: admin.id, newVersion: admin.version }, 'Admin updated successfully');

      return adminResponseSchema.parse(admin);
    } catch (error) {
      this.logger.error({ error, adminId: id }, 'Failed to update admin');
      throw error;
    }
  }

  /**
   * Deletes an admin user using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the admin user to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param userId - Optional ID of the user performing the action for audit purposes
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deleteAdmin(id: string, expectedVersion: number, userId?: string): Promise<void> {
    this.logger.info({ adminId: id, expectedVersion, userId }, 'Deleting admin');

    try {
      const existingAdmin = await db.query.admins.findFirst({ where: eq(admins.id, id) });

      if (!existingAdmin) {
        throw new NotFoundError(`Admin with id ${id} not found`);
      }

      if (existingAdmin.version !== expectedVersion) {
        throw new OptimisticLockError(`Admin version mismatch. Expected ${expectedVersion}, got ${existingAdmin.version}`);
      }

      const deleted = await db.delete(admins).where(and(eq(admins.id, id), eq(admins.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete admin due to version conflict`);
      }

      await this.auditService.logDelete('admin', id, { id: existingAdmin.id, displayName: existingAdmin.displayName, roles: existingAdmin.roles, metadata: existingAdmin.metadata }, userId);

      this.logger.info({ adminId: id }, 'Admin deleted successfully');
    } catch (error) {
      this.logger.error({ error, adminId: id }, 'Failed to delete admin');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific admin user
   * @param adminId - The unique identifier of the admin user
   * @returns Array of audit log entries for the admin user
   */
  async getAdminAuditLogs(adminId: string): Promise<any[]> {
    this.logger.debug({ adminId }, 'Fetching audit logs for admin');

    try {
      return await this.auditService.getEntityAuditLogs('admin', adminId);
    } catch (error) {
      this.logger.error({ error, adminId }, 'Failed to fetch admin audit logs');
      throw error;
    }
  }
}

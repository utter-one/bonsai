import { injectable, inject } from 'tsyringe';
import { eq, and, gte, lte, like, SQL, desc } from 'drizzle-orm';
import { db } from '../db/index';
import { admins } from '../db/schema';
import type { CreateAdminRequest, UpdateAdminRequest, AdminResponse, AdminListResponse, UpdateProfileRequest, ProfileResponse } from '../http/contracts/admin';
import type { ListParams } from '../http/contracts/common';
import { adminResponseSchema, adminListResponseSchema, profileResponseSchema } from '../http/contracts/admin';
import { AuditService } from './AuditService';
import { AuthService } from './AuthService';
import { OptimisticLockError, NotFoundError, InvalidOperationError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS, ROLES } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';

/**
 * Service for managing admin users with full CRUD operations and audit logging
 */
@injectable()
export class AdminService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService, @inject(AuthService) private readonly authService: AuthService) {
    super();
  }

  /**
   * Creates a new admin user and logs the creation in the audit trail
   * @param input - Admin creation data including id, displayName, roles, password, and optional metadata
   * @param context - Request context for auditing and authorization
   * @returns The created admin user (without password)
   */
  async createAdmin(input: CreateAdminRequest, context: RequestContext): Promise<AdminResponse> {
    this.requirePermission(context, PERMISSIONS.ADMIN_WRITE);
    const adminId = input.id;
    if (!adminId) {
      throw new InvalidOperationError('Admin ID (email) must be provided when creating an admin');
    }
    
    logger.info({ adminId, displayName: input.displayName, roles: input.roles, contextAdminId: context?.adminId }, 'Creating admin');

    try {
      // Validate roles exist in ROLES definition
      this.validateRoles(input.roles);

      // Remove duplicate roles
      const distinctRoles = Array.from(new Set(input.roles));

      // Hash password before storing
      const hashedPassword = await this.authService.hashPassword(input.password);

      const admin = await db.insert(admins).values({ id: input.id, displayName: input.displayName, roles: distinctRoles, password: hashedPassword, metadata: input.metadata, version: 1 }).returning();

      const createdAdmin = admin[0];

      await this.auditService.logCreate('admin', createdAdmin.id, { id: createdAdmin.id, displayName: createdAdmin.displayName, roles: createdAdmin.roles, metadata: createdAdmin.metadata }, context?.adminId);

      logger.info({ adminId: createdAdmin.id }, 'Admin created successfully');

      return adminResponseSchema.parse(createdAdmin);
    } catch (error) {
      logger.error({ error, adminId: input.id }, 'Failed to create admin');
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
    logger.debug({ adminId: id }, 'Fetching admin by ID');

    try {
      const admin = await db.query.admins.findFirst({ where: eq(admins.id, id) });

      if (!admin) {
        throw new NotFoundError(`Admin with id ${id} not found`);
      }

      return adminResponseSchema.parse(admin);
    } catch (error) {
      logger.error({ error, adminId: id }, 'Failed to fetch admin');
      throw error;
    }
  }

  /**
   * Lists admin users with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of admin users matching the criteria (without passwords)
   */
  async listAdmins(params?: ListParams): Promise<AdminListResponse> {
    logger.debug({ params }, 'Listing admins');

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
          const condition = buildFilterCondition(field, filter, columnMap, logger);
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
      logger.error({ error, params }, 'Failed to list admins');
      throw error;
    }
  }

  /**
   * Updates an admin user using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the admin user to update
   * @param input - Admin update data including displayName, roles, password, and metadata (without version)
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @returns The updated admin user (without password)
   * @throws {NotFoundError} When admin is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateAdmin(id: string, input: Omit<UpdateAdminRequest, 'version'>, expectedVersion: number, context: RequestContext): Promise<AdminResponse> {
    this.requirePermission(context, PERMISSIONS.ADMIN_WRITE);
    logger.info({ adminId: id, expectedVersion, contextAdminId: context?.adminId }, 'Updating admin');

    try {
      const existingAdmin = await db.query.admins.findFirst({ where: eq(admins.id, id) });

      if (!existingAdmin) {
        throw new NotFoundError(`Admin with id ${id} not found`);
      }

      if (existingAdmin.version !== expectedVersion) {
        throw new OptimisticLockError(`Admin version mismatch. Expected ${expectedVersion}, got ${existingAdmin.version}`);
      }

      // Validate roles if being updated
      if (input.roles) {
        this.validateRoles(input.roles);
      }

      // Hash password if it's being updated
      const updateData: any = {
        displayName: input.displayName,
        roles: input.roles ? Array.from(new Set(input.roles)) : undefined,
        metadata: input.metadata,
        version: existingAdmin.version + 1,
        updatedAt: new Date(),
      };

      if (input.password) {
        updateData.password = await this.authService.hashPassword(input.password);
      }

      const updatedAdmin = await db.update(admins).set(updateData).where(and(eq(admins.id, id), eq(admins.version, expectedVersion))).returning();

      if (updatedAdmin.length === 0) {
        throw new OptimisticLockError(`Failed to update admin due to version conflict`);
      }

      const admin = updatedAdmin[0];

      await this.auditService.logUpdate('admin', admin.id, { id: existingAdmin.id, displayName: existingAdmin.displayName, roles: existingAdmin.roles, metadata: existingAdmin.metadata }, { id: admin.id, displayName: admin.displayName, roles: admin.roles, metadata: admin.metadata }, context?.adminId);

      logger.info({ adminId: admin.id, newVersion: admin.version }, 'Admin updated successfully');

      return adminResponseSchema.parse(admin);
    } catch (error) {
      logger.error({ error, adminId: id }, 'Failed to update admin');
      throw error;
    }
  }

  /**
   * Deletes an admin user using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the admin user to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deleteAdmin(id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.ADMIN_DELETE);
    logger.info({ adminId: id, expectedVersion, contextAdminId: context?.adminId }, 'Deleting admin');

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

      await this.auditService.logDelete('admin', id, { id: existingAdmin.id, displayName: existingAdmin.displayName, roles: existingAdmin.roles, metadata: existingAdmin.metadata }, context?.adminId);

      logger.info({ adminId: id }, 'Admin deleted successfully');
    } catch (error) {
      logger.error({ error, adminId: id }, 'Failed to delete admin');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific admin user
   * @param adminId - The unique identifier of the admin user
   * @returns Array of audit log entries for the admin user
   */
  async getAdminAuditLogs(adminId: string): Promise<any[]> {
    logger.debug({ adminId }, 'Fetching audit logs for admin');

    try {
      return await this.auditService.getEntityAuditLogs('admin', adminId);
    } catch (error) {
      logger.error({ error, adminId }, 'Failed to fetch admin audit logs');
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
   * Retrieves the profile of the currently logged-in admin user
   * @param context - Request context containing the authenticated admin ID
   * @returns The profile information of the logged-in admin
   * @throws {NotFoundError} When admin is not found
   */
  async getProfile(context: RequestContext): Promise<ProfileResponse> {
    logger.debug({ adminId: context.adminId }, 'Fetching profile for logged-in admin');

    try {
      const admin = await db.query.admins.findFirst({ where: eq(admins.id, context.adminId) });

      if (!admin) {
        throw new NotFoundError(`Admin with id ${context.adminId} not found`);
      }

      return profileResponseSchema.parse(admin);
    } catch (error) {
      logger.error({ error, adminId: context.adminId }, 'Failed to fetch profile');
      throw error;
    }
  }

  /**
   * Updates the profile of the currently logged-in admin user
   * Allows changing display name and/or password
   * When changing password, the old password must be verified first
   * @param input - Profile update data including displayName, oldPassword, and newPassword
   * @param context - Request context containing the authenticated admin ID
   * @returns The updated profile information
   * @throws {NotFoundError} When admin is not found
   * @throws {Error} When old password is invalid
   */
  async updateProfile(input: UpdateProfileRequest, context: RequestContext): Promise<ProfileResponse> {
    logger.info({ adminId: context.adminId }, 'Updating profile for logged-in admin');

    try {
      const existingAdmin = await db.query.admins.findFirst({ where: eq(admins.id, context.adminId) });

      if (!existingAdmin) {
        throw new NotFoundError(`Admin with id ${context.adminId} not found`);
      }

      // Verify old password if changing password
      if (input.newPassword) {
        if (!input.oldPassword) {
          throw new Error('Old password is required when changing password');
        }

        const isValidPassword = await this.authService.verifyPassword(input.oldPassword, existingAdmin.password);
        if (!isValidPassword) {
          throw new Error('Invalid old password');
        }
      }

      // Build update data
      const updateData: any = {
        version: existingAdmin.version + 1,
        updatedAt: new Date(),
      };

      if (input.displayName) {
        updateData.displayName = input.displayName;
      }

      if (input.newPassword) {
        updateData.password = await this.authService.hashPassword(input.newPassword);
      }

      const updatedAdmin = await db.update(admins).set(updateData).where(eq(admins.id, context.adminId)).returning();

      if (updatedAdmin.length === 0) {
        throw new Error('Failed to update profile');
      }

      const admin = updatedAdmin[0];

      // Log the update for audit purposes
      const oldData: any = { id: existingAdmin.id, displayName: existingAdmin.displayName };
      const newData: any = { id: admin.id, displayName: admin.displayName };
      
      if (input.newPassword) {
        oldData.passwordChanged = false;
        newData.passwordChanged = true;
      }

      await this.auditService.logUpdate('admin', admin.id, oldData, newData, context.adminId);

      logger.info({ adminId: admin.id, newVersion: admin.version }, 'Profile updated successfully');

      return profileResponseSchema.parse(admin);
    } catch (error) {
      logger.error({ error, adminId: context.adminId }, 'Failed to update profile');
      throw error;
    }
  }
}
